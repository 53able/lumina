import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany, generateText } from "ai";
import type { Context } from "hono";
import { env } from "hono/adapter";
import { z } from "zod";
import {
  type EvidenceSentence,
  resolveKeyPointEvidence,
  splitAbstractSentences,
} from "../../shared/utils/abstractSentences";
import type { Env } from "../types/env";

/**
 * 生成タスクごとの使用モデル
 */
export interface ModelConfig {
  /** クエリ拡張（英訳・同義語） */
  queryExpansion: string;
  /** 要約生成 */
  summary: string;
  /** 説明文生成 */
  explanation: string;
}

/**
 * 生成タスクのデフォルトモデル
 */
export const DEFAULT_MODELS: ModelConfig = {
  queryExpansion: "gpt-6-luna",
  summary: "gpt-6-luna",
  explanation: "gpt-6-luna",
};

/**
 * Embeddingモデル
 *
 * @remarks
 * クライアントに保存済みの1536次元ベクトルと互換性を保つため、環境変数では変更できない。
 * 変更する場合は保存済みEmbeddingの再生成が必要。
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * 生成タスクのモデルを上書きする環境変数名
 */
const MODEL_ENV_KEYS: Record<keyof ModelConfig, string> = {
  queryExpansion: "OPENAI_MODEL_QUERY_EXPANSION",
  summary: "OPENAI_MODEL_SUMMARY",
  explanation: "OPENAI_MODEL_EXPLANATION",
};

/**
 * OpenAI API設定
 */
export interface OpenAIConfig {
  /** APIキー */
  apiKey: string;
  /** ベースURL（オプション） */
  baseUrl?: string;
  /** タスクごとの使用モデル（未指定のタスクはDEFAULT_MODELSを使う） */
  models?: Partial<ModelConfig>;
}

/**
 * Embedding生成結果
 */
export interface EmbeddingResult {
  /** 1536次元のEmbeddingベクトル */
  embedding: number[];
  /** 使用トークン数 */
  tokensUsed: number;
}

/**
 * クエリ拡張結果
 */
export interface ExpandedQuery {
  /** 元のクエリ */
  original: string;
  /** 英訳されたクエリ */
  english: string;
  /** 同義語・関連語 */
  synonyms: string[];
  /** 検索用テキスト */
  searchText: string;
}

/**
 * 要約結果
 */
export interface SummaryResult {
  /** 要約テキスト */
  summary: string;
  /** キーポイント */
  keyPoints: string[];
  /**
   * キーポイントごとの根拠（keyPoints と同じ順序）
   * サーバーで Abstract に実在すると確かめた文だけを含み、対応できなかったキーポイントは空配列
   */
  keyPointEvidence: EvidenceSentence[][];
}

/**
 * 認知負荷最適化説明文の結果
 *
 * @description
 * Context Engineering + "Why Your Writing Isn't Being Read" の教訓:
 * - 要約（summary）= 事実ベース: この論文は何をしているか
 * - 説明文（explanation）= 読者ベース: なぜあなたはこの論文を読むべきか
 */
export interface ExplanationResult {
  /** 認知負荷を最適化した説明文（読者の問題→解決策の形式） */
  explanation: string;
  /** 対象読者 */
  targetAudience: string;
  /** 読む理由（この論文を読むと何が得られるか） */
  whyRead: string;
}

/**
 * OpenAI APIキーが設定されていないときに getOpenAIConfig が投げるエラー
 */
export class OpenAIApiKeyNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIApiKeyNotConfiguredError";
  }
}

/**
 * リクエストからOpenAI APIキーを取得する
 *
 * 優先順位: 1. リクエストヘッダー (X-OpenAI-API-Key) 2. 環境変数 (OPENAI_API_KEY)
 *
 * @remarks
 * 本番環境では環境変数を使用しない（セキュリティリスク）。
 * 本番環境ではクライアント側のヘッダーからのAPIキーのみを受け入れる。
 *
 * @param c - Hono Context
 * @returns OpenAI設定オブジェクト
 * @throws APIキーが設定されていない場合
 */
export const getOpenAIConfig = (c: Context<{ Bindings: Env }>): OpenAIConfig => {
  const headerKey = c.req.header("X-OpenAI-API-Key");
  const envKey = c.env?.OPENAI_API_KEY;

  // 本番環境では環境変数を使用しない（セキュリティリスク）
  const isProduction = c.env?.NODE_ENV === "production";
  const apiKey = headerKey ?? (isProduction ? undefined : envKey);

  if (!apiKey) {
    const errorMessage = isProduction
      ? "OpenAI API key is not configured. In production, you must pass X-OpenAI-API-Key header. Environment variables are not used for security reasons."
      : "OpenAI API key is not configured. Set OPENAI_API_KEY environment variable or pass X-OpenAI-API-Key header.";
    throw new OpenAIApiKeyNotConfiguredError(errorMessage);
  }

  return { apiKey, models: resolveModels(env(c)) };
};

/**
 * 環境変数からタスクごとの使用モデルを解決する
 *
 * 未設定・空文字のタスクはDEFAULT_MODELSを使う。
 */
export const resolveModels = (vars: Record<string, unknown> | undefined): ModelConfig => {
  const resolved = { ...DEFAULT_MODELS };
  for (const task of Object.keys(MODEL_ENV_KEYS) as (keyof ModelConfig)[]) {
    const value = vars?.[MODEL_ENV_KEYS[task]];
    if (typeof value === "string" && value.trim() !== "") {
      resolved[task] = value.trim();
    }
  }
  return resolved;
};

const getModel = (config: OpenAIConfig, task: keyof ModelConfig): string =>
  config.models?.[task] ?? DEFAULT_MODELS[task];

/**
 * モデルに応じたサンプリング設定を返す
 *
 * @remarks
 * gpt-6 系は推論モデルで reasoning effort のデフォルトが medium。
 * 定型的な短文生成なので "none" にして推論トークン課金とレイテンシを抑える。
 * temperature は reasoning effort が "none" のときのみ受け付けられる。
 * @ai-sdk/openai 1.x は gpt-6 系を推論モデルとして認識しないため、ここで指定する。
 */
const samplingSettings = (modelId: string, temperature: number) =>
  /^(ft:)?gpt-6/.test(modelId)
    ? { temperature, providerOptions: { openai: { reasoningEffort: "none" } } }
    : { temperature };

/**
 * OpenAIプロバイダーを作成する
 */
const createProvider = (config: OpenAIConfig) => {
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
};

/**
 * テキストからEmbeddingベクトルを生成する
 */
export const createEmbedding = async (
  text: string,
  config: OpenAIConfig
): Promise<EmbeddingResult> => {
  const provider = createProvider(config);

  const { embedding, usage } = await embed({
    model: provider.embedding(EMBEDDING_MODEL),
    value: text,
  });

  return {
    embedding,
    tokensUsed: usage.tokens,
  };
};

/**
 * 複数テキストを1リクエストで Embedding に変換する（バッチ）
 *
 * @param texts 対象テキスト配列（1件以上、推奨は 20 件以下）
 * @param config OpenAI 設定
 * @returns 入力順の Embedding 配列と合計トークン数
 */
export const createEmbeddingsBatch = async (
  texts: string[],
  config: OpenAIConfig
): Promise<{ embeddings: number[][]; tokensUsed: number }> => {
  if (texts.length === 0) {
    return { embeddings: [], tokensUsed: 0 };
  }

  const provider = createProvider(config);

  const { embeddings, usage } = await embedMany({
    model: provider.embedding(EMBEDDING_MODEL),
    values: texts,
  });

  const vectors: number[][] = embeddings.map((e) =>
    Array.isArray(e) ? e : (e as { values: number[] }).values
  );
  return {
    embeddings: vectors,
    tokensUsed: usage.tokens,
  };
};

/**
 * クエリ拡張結果のスキーマ
 * @remarks Zod v4ではdescribeがzod-to-json-schemaで問題を起こすため、シンプルに定義
 */
const ExpandedQuerySchema = z.object({
  original: z.string(),
  english: z.string(),
  synonyms: z.array(z.string()),
  searchText: z.string(),
});

/**
 * クエリ拡張用のシステムプロンプト
 *
 * @description
 * Context Engineering Best Practices に基づく構造化プロンプト:
 * - Role: 専門領域の明示
 * - Context: arXiv学術論文検索の背景
 * - Task: 具体的なタスク定義
 * - Constraints: 出力制約・品質基準
 * - Examples: Few-shot学習のための例
 */
const QUERY_EXPANSION_SYSTEM_PROMPT = `# Role
You are an expert academic search query optimizer specializing in computer science and machine learning research on arXiv.

# Context
- Target: arXiv academic paper search (primarily cs.*, stat.ML categories)
- Users: Researchers and engineers searching for relevant papers
- Input: Often in Japanese or informal English
- Goal: Maximize recall while maintaining precision in semantic search

# Your Task
Transform user search queries into optimized forms for embedding-based semantic search.

# Output Schema (JSON)
{
  "original": "<verbatim user query>",
  "english": "<academic English translation>",
  "synonyms": ["<3-5 related academic terms>"],
  "searchText": "<concatenated optimized search string>"
}

# Quality Criteria
1. **english**: Use formal academic terminology, not casual translations
2. **synonyms**: Include abbreviations (e.g., LLM ↔ Large Language Model), related concepts, and methodology variants
3. **searchText**: Combine key terms with academic phrasing that matches paper abstracts

# Constraints
- NEVER include speculative or fabricated terms
- Preserve technical precision (e.g., "transformer" ≠ "converter")
- Maintain semantic equivalence between original and expanded forms`;

/**
 * クエリ拡張用のFew-shot例
 */
const QUERY_EXPANSION_EXAMPLES = `
<example>
Input: "深層学習でテキスト分類"
Output: {"original":"深層学習でテキスト分類","english":"deep learning text classification","synonyms":["neural network text categorization","NLP document classification","transformer-based text classification","BERT text classification","sentiment analysis"],"searchText":"deep learning neural network text classification NLP document categorization transformer BERT"}
</example>

<example>
Input: "LLMの推論効率化"
Output: {"original":"LLMの推論効率化","english":"LLM inference optimization","synonyms":["large language model efficient inference","transformer acceleration","model compression","knowledge distillation","quantization for LLMs"],"searchText":"large language model LLM inference optimization efficient transformer acceleration quantization distillation"}
</example>`;

/**
 * 検索クエリを英訳し、同義語で拡張する
 *
 * @description
 * Context Engineering アプローチ:
 * 1. System prompt で Role/Context/Task を明確化
 * 2. Few-shot examples で望ましい出力形式を提示
 * 3. User prompt は最小限に（情報密度最大化）
 */
export const expandQuery = async (query: string, config: OpenAIConfig): Promise<ExpandedQuery> => {
  const provider = createProvider(config);

  const modelId = getModel(config, "queryExpansion");
  const { text } = await generateText({
    model: provider(modelId),
    system: QUERY_EXPANSION_SYSTEM_PROMPT,
    prompt: `${QUERY_EXPANSION_EXAMPLES}

<input>
${query}
</input>

Respond with valid JSON only.`,
    ...samplingSettings(modelId, 0.2), // 低めに設定して一貫性を重視
  });

  const parsed = ExpandedQuerySchema.parse(JSON.parse(text));
  return parsed;
};

/**
 * 要約結果のスキーマ
 * @remarks Zod v4ではdescribeがzod-to-json-schemaで問題を起こすため、シンプルに定義
 */
const SummaryResultSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
});

/** プロンプトのタグ内に置く本文の "&" "<" ">" をエスケープする（本文によるタグの偽装を防ぐ） */
const escapeTagText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 認知負荷最適化説明文のスキーマ
 */
const ExplanationResultSchema = z.object({
  explanation: z.string(),
  targetAudience: z.string(),
  whyRead: z.string(),
});

/**
 * 要約用のシステムプロンプト（共通部分）
 *
 * @description
 * Context Engineering Best Practices に基づく構造化プロンプト:
 * - Role: 学術論文の専門家としての視点
 * - Context: arXiv論文アブストラクトの構造理解
 * - Task: Chain-of-Thought による段階的要約
 * - Quality: 学術的正確性と読みやすさのバランス
 */
const SUMMARY_SYSTEM_PROMPT_BASE = `# Role
You are a senior research scientist with expertise in reading and distilling academic papers. You specialize in machine learning, NLP, and computer science.

# Context
- Source: arXiv paper abstracts (typically 150-300 words)
- Audience: Researchers and engineers evaluating papers for relevance
- Purpose: Quick comprehension and decision-making on whether to read full paper

# Abstract Structure Awareness
Academic abstracts typically follow IMRaD structure:
- Background/Motivation: Why this research matters
- Objective: What the paper aims to achieve
- Methods: Key techniques or approaches used
- Results: Main findings or contributions
- Conclusion: Implications or significance

# Your Task (Chain-of-Thought)
1. **Identify** the core research question or problem
2. **Extract** the proposed method/approach
3. **Capture** the key results or contributions
4. **Synthesize** into a coherent summary

# Input Format
The abstract is given as sentences wrapped in <s id="N">...</s> tags (N is the sentence number, starting at 0).

# Output Schema (JSON)
{
  "summary": "<2-3 sentence synthesis covering problem→method→contribution>",
  "keyPoints": ["<specific, actionable insight 1>", "<insight 2>", ...],
  "evidence": [[<sentence numbers supporting keyPoints[0]>], [<numbers for keyPoints[1]>], ...]
}

# Quality Criteria
- **summary**: Must answer "What did they do and why does it matter?"
- **keyPoints**: 
  - 3-5 bullet points
  - Each point should be self-contained and specific
  - Include quantitative results when available (e.g., "Achieves 95% accuracy")
  - Highlight novel contributions over standard methodology
- **evidence**:
  - One array per key point, in the same order as keyPoints
  - List only the numbers of sentences that directly state the key point (usually 1-2)
  - Use an empty array if no single sentence directly states it. Never guess a number

# Constraints
- NEVER hallucinate claims not present in the abstract
- Preserve technical terms accurately (e.g., don't simplify "attention mechanism" to "focus system")
- If the abstract is vague, reflect that uncertainty in the summary`;

/**
 * 日本語出力用の追加指示
 */
const SUMMARY_INSTRUCTION_JA = `
# Language Instruction
Respond entirely in Japanese (日本語).
- Use appropriate Japanese technical terminology
- Maintain academic tone (である調)
- Example: "Transformer" → "Transformer"（カタカナ化しない専門用語）
- Example: "proposes" → "提案する"`;

/**
 * 英語出力用の追加指示
 */
const SUMMARY_INSTRUCTION_EN = `
# Language Instruction
Respond entirely in English.
- Use formal academic English
- Maintain concise, precise phrasing`;

/**
 * 要約用のFew-shot例（日本語）
 */
const SUMMARY_EXAMPLE_JA = `
<example>
Abstract:
<s id="0">We introduce GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs.</s>
<s id="1">While less capable than humans in many real-world scenarios, GPT-4 exhibits human-level performance on various professional and academic benchmarks.</s>

Output: {"summary":"本論文はGPT-4を紹介する。GPT-4は画像とテキストを入力として受け付け、テキストを出力するマルチモーダルモデルである。実世界のシナリオでは人間に及ばない点もあるが、様々な専門的・学術的ベンチマークで人間レベルの性能を達成した。","keyPoints":["画像・テキスト入力に対応したマルチモーダル大規模言語モデル","専門的・学術的ベンチマークで人間レベルの性能を実証","実世界タスクでは人間との性能差が依然として存在"],"evidence":[[0],[1],[1]]}
</example>`;

/**
 * 要約用のFew-shot例（英語）
 */
const SUMMARY_EXAMPLE_EN = `
<example>
Abstract:
<s id="0">We introduce GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs.</s>
<s id="1">While less capable than humans in many real-world scenarios, GPT-4 exhibits human-level performance on various professional and academic benchmarks.</s>

Output: {"summary":"This paper introduces GPT-4, a large-scale multimodal model capable of processing both image and text inputs to generate text outputs. The model achieves human-level performance on professional and academic benchmarks, though gaps remain in real-world scenarios.","keyPoints":["Multimodal architecture accepting both image and text inputs","Human-level performance demonstrated on professional/academic benchmarks","Performance gap identified in real-world application scenarios"],"evidence":[[0],[1],[1]]}
</example>`;

/**
 * 論文アブストラクトから要約を生成する
 *
 * @description
 * Context Engineering アプローチ:
 * 1. System prompt で専門家ロールとChain-of-Thought思考プロセスを誘導
 * 2. 学術論文構造（IMRaD）への認識を付与
 * 3. Few-shot example で出力品質を担保
 * 4. 言語別の指示を分離して明確化
 * 5. Abstract を決定的に文分割して番号を付け、キーポイントごとの根拠の文番号を返させる。
 *    返された番号は Abstract に実在する文だけを残す（実在しない番号は「対応箇所未確認」にする）
 */
export const generateSummary = async (
  abstract: string,
  language: "ja" | "en",
  config: OpenAIConfig
): Promise<SummaryResult> => {
  const provider = createProvider(config);
  const langInstruction = language === "ja" ? SUMMARY_INSTRUCTION_JA : SUMMARY_INSTRUCTION_EN;
  const example = language === "ja" ? SUMMARY_EXAMPLE_JA : SUMMARY_EXAMPLE_EN;

  const sentences = splitAbstractSentences(abstract);
  // 文番号は本文に現れにくいタグで付け、本文中の "<" ">" はエスケープしてタグや番号の偽装を防ぐ
  const numberedAbstract = sentences
    .map((sentence, i) => `<s id="${i}">${escapeTagText(sentence)}</s>`)
    .join("\n");

  const modelId = getModel(config, "summary");
  const { text } = await generateText({
    model: provider(modelId),
    system: `${SUMMARY_SYSTEM_PROMPT_BASE}${langInstruction}`,
    prompt: `${example}

<abstract>
${numberedAbstract}
</abstract>

Respond with valid JSON only.`,
    ...samplingSettings(modelId, 0.3),
  });

  const json: unknown = JSON.parse(text);
  const { summary, keyPoints } = SummaryResultSchema.parse(json);
  // evidence は要約本体とは別に、キーポイント・番号ごとに検証する（不正な番号だけを捨て、要約は失敗させない）
  const rawEvidence =
    json && typeof json === "object" ? (json as { evidence?: unknown }).evidence : undefined;
  return {
    summary,
    keyPoints,
    keyPointEvidence: resolveKeyPointEvidence(sentences, keyPoints.length, rawEvidence),
  };
};

/**
 * 認知負荷最適化説明文用のシステムプロンプト
 *
 * @description
 * "Why Your Writing Isn't Being Read" + Context Engineering の教訓:
 * - 要約をそのままタイトルにしない（中身がわかると読む理由がなくなる）
 * - 読者が「自分のための文章だ」と感じる書き方
 * - 問題提示 → 解決策の予告 → 読むメリット
 */
const EXPLANATION_SYSTEM_PROMPT_BASE = `# Role
You are a research communication specialist who makes academic papers accessible and compelling to the reader. Your expertise is in reducing cognitive load while maximizing reader engagement.

# Context
- Source: arXiv paper abstracts
- Goal: Create a reader-centric explanation that makes the reader want to explore the paper
- Key Insight: Summaries tell WHAT the paper does; Explanations tell WHY the reader should care

# Your Task (Cognitive Load Optimization)
Transform a paper abstract into a reader-engaging explanation using this framework:

1. **Hook with a Problem**: Start with a relatable pain point or question the target audience faces
2. **Promise the Solution**: Hint at what the paper offers WITHOUT summarizing the entire content
3. **Identify Who Benefits**: Clearly define who should read this paper

# Output Schema (JSON)
{
  "explanation": "<2-3 sentences: Problem hook + Solution promise. Do NOT summarize the paper's findings directly.>",
  "targetAudience": "<Specific reader profile who would benefit most>",
  "whyRead": "<One sentence: What insight/skill/capability the reader gains>"
}

# Quality Criteria (Critical)
- **explanation** must start with a reader's problem or question, NOT with "This paper..."
- **explanation** should create curiosity, not satisfy it (don't reveal the full answer)
- Use "you/your" language to address the reader directly
- Keep cognitive load low: simple sentence structure, familiar vocabulary where possible

# Anti-patterns to Avoid
❌ "This paper proposes..." (paper-centric, not reader-centric)
❌ "We present a method that achieves 95% accuracy" (spoils the content)
❌ "A novel approach to..." (academic jargon, low engagement)

# Good Patterns
✅ "Struggling with X? Here's a new perspective that could change how you approach..."
✅ "What if you could Y without Z? This research explores..."
✅ "If you've ever wondered why A happens, this paper offers..."`;

/**
 * 日本語出力用の追加指示
 */
const EXPLANATION_INSTRUCTION_JA = `
# Language Instruction
Respond entirely in Japanese (日本語).
- Use casual yet professional tone (ですます調)
- Address the reader directly using "あなた" or implied second person
- Example hook: "〜に悩んでいませんか？" "〜と思ったことはありませんか？"`;

/**
 * 英語出力用の追加指示
 */
const EXPLANATION_INSTRUCTION_EN = `
# Language Instruction
Respond entirely in English.
- Use conversational yet professional tone
- Address the reader directly using "you/your"
- Example hook: "Struggling with...?" "Ever wondered why...?"`;

/**
 * 説明文用のFew-shot例（日本語）
 */
const EXPLANATION_EXAMPLE_JA = `
<example>
Abstract: "We introduce GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs. While less capable than humans in many real-world scenarios, GPT-4 exhibits human-level performance on various professional and academic benchmarks."

Output: {"explanation":"テキストだけでなく画像も理解できるAIがあったら、あなたの作業はどう変わりますか？この論文は、その可能性を大きく広げる技術について紹介しています。ただし、万能ではありません—どこが得意でどこが苦手なのか、実際に使う前に知っておくべきポイントがあります。","targetAudience":"マルチモーダルAIの実用化に関心があるエンジニア・プロダクトマネージャー","whyRead":"GPT-4の実力と限界を正しく理解し、適切なユースケースを見極める判断材料が得られます"}
</example>`;

/**
 * 説明文用のFew-shot例（英語）
 */
const EXPLANATION_EXAMPLE_EN = `
<example>
Abstract: "We introduce GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs. While less capable than humans in many real-world scenarios, GPT-4 exhibits human-level performance on various professional and academic benchmarks."

Output: {"explanation":"What if your AI assistant could understand images as well as text? This paper explores a technology that significantly expands those possibilities. But it's not magic—there are important limitations you should know before integrating it into your workflow.","targetAudience":"Engineers and product managers interested in practical multimodal AI applications","whyRead":"Gain a realistic understanding of GPT-4's strengths and limitations to make informed decisions about its use cases"}
</example>`;

/**
 * 論文アブストラクトから認知負荷最適化説明文を生成する
 *
 * @description
 * Context Engineering + "Why Your Writing Isn't Being Read" アプローチ:
 * 1. 読者の問題から始める（Hook with a Problem）
 * 2. 解決策を予告する（Promise the Solution）
 * 3. 読むメリットを明示する（Why Read）
 *
 * @param abstract - 論文のアブストラクト
 * @param language - 出力言語（ja/en）
 * @param config - OpenAI設定
 * @returns 認知負荷最適化された説明文
 */
export const generateExplanation = async (
  abstract: string,
  language: "ja" | "en",
  config: OpenAIConfig
): Promise<ExplanationResult> => {
  const provider = createProvider(config);
  const langInstruction =
    language === "ja" ? EXPLANATION_INSTRUCTION_JA : EXPLANATION_INSTRUCTION_EN;
  const example = language === "ja" ? EXPLANATION_EXAMPLE_JA : EXPLANATION_EXAMPLE_EN;

  const modelId = getModel(config, "explanation");
  const { text } = await generateText({
    model: provider(modelId),
    system: `${EXPLANATION_SYSTEM_PROMPT_BASE}${langInstruction}`,
    prompt: `${example}

<abstract>
${abstract}
</abstract>

Respond with valid JSON only.`,
    ...samplingSettings(modelId, 0.4), // 要約より少し高め（創造性を許容）
  });

  const parsed = ExplanationResultSchema.parse(JSON.parse(text));
  return parsed;
};
