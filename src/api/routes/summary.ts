import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { now } from "../../shared/utils/dateTime";
import { toStageError, UPSTREAM_ERROR_STATUS } from "../lib/upstreamError";
import { generateExplanation, generateSummary, getOpenAIConfig } from "../services/openai";
import type { Env } from "../types/env";

/**
 * 生成対象の種類
 * - explanation: 説明文のみ（既存の要約がある場合）
 * - both: 要約と説明文の両方
 */
const GenerateTargetSchema = z.enum(["explanation", "both"]);

/**
 * Abstract の最大文字数
 * arXiv の Abstract は約2,000文字以内。AI 呼び出し前の文分割などの処理量を入力で増やされないよう上限を設ける
 */
export const SUMMARY_ABSTRACT_MAX_LENGTH = 10_000;

/**
 * 要約リクエストのスキーマ
 */
const SummaryRequestSchema = z.object({
  /** 要約の言語 */
  language: z.enum(["ja", "en"]),
  /** 論文のアブストラクト（クライアント側から渡される） */
  abstract: z.string().min(1).max(SUMMARY_ABSTRACT_MAX_LENGTH).optional(),
  /** 生成対象（デフォルト: both） */
  generateTarget: GenerateTargetSchema.optional().default("both"),
  /** @deprecated includeExplanation は generateTarget に置き換え */
  includeExplanation: z.boolean().optional(),
});

/** 全体の失敗時に error として返す固定文言（上流のエラー文の代わり） */
const SUMMARY_FAILED_MESSAGE = "要約の生成に失敗しました";

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
  // 要求の検証の失敗（Abstract の上限超過など）は再試行で解決しないため、retryable: false の分類で返す
  zValidator("json", SummaryRequestSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "要約の要求が正しくありません", code: "invalid_input", retryable: false } as const,
        400
      );
    }
  }),
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
          // キーポイントごとの根拠（Abstract に実在すると確かめた文だけ。要約を生成した場合のみ）
          ...(summaryResult && { keyPointEvidence: summaryResult.keyPointEvidence }),
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
        UPSTREAM_ERROR_STATUS[stageError.code]
      );
    }
  }
);
