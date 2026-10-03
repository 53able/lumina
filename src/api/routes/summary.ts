import { zValidator } from "@hono/zod-validator";
import { RetryError } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { now } from "../../shared/utils/dateTime";
import {
  generateExplanation,
  generateSummary,
  getOpenAIConfig,
  OpenAIApiKeyNotConfiguredError,
} from "../services/openai";
import type { Env } from "../types/env";

/**
 * 生成対象の種類
 * - explanation: 説明文のみ（既存の要約がある場合）
 * - both: 要約と説明文の両方
 */
const GenerateTargetSchema = z.enum(["explanation", "both"]);

/**
 * 要約リクエストのスキーマ
 */
const SummaryRequestSchema = z.object({
  /** 要約の言語 */
  language: z.enum(["ja", "en"]),
  /** 論文のアブストラクト（クライアント側から渡される） */
  abstract: z.string().min(1).optional(),
  /** 生成対象（デフォルト: both） */
  generateTarget: GenerateTargetSchema.optional().default("both"),
  /** @deprecated includeExplanation は generateTarget に置き換え */
  includeExplanation: z.boolean().optional(),
});

/**
 * 工程の失敗を、上流のエラー文を含まない安全な分類へ変換する
 * クライアントは code から案内文を作る（rate_limit: 待つ / auth: 設定を直す / それ以外: 再試行）
 */
const toStageError = (
  error: unknown
): { code: "rate_limit" | "auth" | "invalid_output" | "upstream"; retryable: boolean } => {
  if (error instanceof OpenAIApiKeyNotConfiguredError) return { code: "auth", retryable: false };
  // generateExplanation は AI の出力を JSON.parse → zod で検証する
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return { code: "invalid_output", retryable: true };
  }
  // AI SDK は 429 などを再試行し、上限到達時は RetryError に包んで投げる（statusCode は lastError 側）
  const source = RetryError.isInstance(error) ? error.lastError : error;
  const statusCode =
    source && typeof source === "object" && "statusCode" in source
      ? (source as { statusCode: unknown }).statusCode
      : undefined;
  if (statusCode === 401 || statusCode === 403) return { code: "auth", retryable: false };
  if (statusCode === 429) return { code: "rate_limit", retryable: true };
  return { code: "upstream", retryable: true };
};

/** 全体の失敗時に error として返す固定文言（上流のエラー文の代わり） */
const SUMMARY_FAILED_MESSAGE = "要約の生成に失敗しました";

/** 分類ごとの HTTP ステータス（キー未設定・401/403 → 401、429 → 429、それ以外 → 500） */
const SUMMARY_ERROR_STATUS = {
  auth: 401,
  rate_limit: 429,
  invalid_output: 500,
  upstream: 500,
} as const satisfies Record<ReturnType<typeof toStageError>["code"], number>;

/**
 * スタブ用の要約を生成（abstractがない場合のフォールバック）
 */
const generateStubSummary = (paperId: string, language: "ja" | "en"): string => {
  if (language === "ja") {
    return `論文 ${paperId} の要約です。この論文では...`;
  }
  return `Summary of paper ${paperId}. This paper presents...`;
};

/**
 * スタブ用のキーポイントを生成
 */
const generateStubKeyPoints = (language: "ja" | "en"): string[] => {
  if (language === "ja") {
    return ["キーポイント1", "キーポイント2", "キーポイント3"];
  }
  return ["Key point 1", "Key point 2", "Key point 3"];
};

/**
 * 要約 API アプリケーション
 */
export const summaryApp = new Hono<{ Bindings: Env }>().post(
  "/summary/:id",
  zValidator("json", SummaryRequestSchema),
  async (c) => {
    const paperId = c.req.param("id");
    const { language, abstract, generateTarget, includeExplanation } = c.req.valid("json");

    // 後方互換性: includeExplanation が true なら generateTarget を "both" に
    const target = includeExplanation === true ? "both" : (generateTarget ?? "both");

    // abstractがない場合はスタブを返す
    if (!abstract) {
      return c.json(
        {
          paperId,
          summary: generateStubSummary(paperId, language),
          keyPoints: generateStubKeyPoints(language),
          language,
          createdAt: now(),
        },
        200
      );
    }

    try {
      const config = getOpenAIConfig(c);

      // 生成対象に応じて処理を分岐
      const shouldGenerateSummary = target === "both";
      const shouldGenerateExplanation = target === "explanation" || target === "both";

      // 要約生成（対象の場合のみ）
      const summaryResult = shouldGenerateSummary
        ? await generateSummary(abstract, language, config)
        : undefined;

      // 説明文生成（対象の場合のみ）
      // 要約の生成後に説明文だけが失敗した場合は、成功済みの要約を失わないよう
      // 部分成功（explanationError 付きの 200）として返す。要約がない場合は全体の失敗として扱う
      let explanationResult: Awaited<ReturnType<typeof generateExplanation>> | undefined;
      let explanationError: ReturnType<typeof toStageError> | undefined;
      if (shouldGenerateExplanation) {
        try {
          explanationResult = await generateExplanation(abstract, language, config);
        } catch (error) {
          if (!summaryResult) throw error;
          explanationError = toStageError(error);
        }
      }

      return c.json(
        {
          paperId,
          // 要約がない場合は空文字列を返す（説明文のみ生成の場合）
          summary: summaryResult?.summary ?? "",
          keyPoints: summaryResult?.keyPoints ?? [],
          ...(explanationResult && {
            explanation: explanationResult.explanation,
            targetAudience: explanationResult.targetAudience,
            whyRead: explanationResult.whyRead,
          }),
          // 説明文の工程だけが失敗した場合の分類（上流のエラー文は含めない。クライアントは要約を保存し、説明文だけを再試行する）
          ...(explanationError !== undefined && { explanationError }),
          language,
          createdAt: now(),
        },
        200
      );
    } catch (error) {
      // 全体の失敗も工程別の失敗と同じ分類で返し、上流のエラー文（キーの一部を含みうる）は返さない。
      // error は古いクライアント向けの固定文言。ステータスは Embedding API（#44）に揃える
      const stageError = toStageError(error);
      return c.json(
        { error: SUMMARY_FAILED_MESSAGE, ...stageError },
        SUMMARY_ERROR_STATUS[stageError.code]
      );
    }
  }
);
