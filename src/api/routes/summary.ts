import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { now } from "../../shared/utils/dateTime";
import { generateExplanation, generateSummary, getOpenAIConfig } from "../services/openai";
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
      return c.json({
        paperId,
        summary: generateStubSummary(paperId, language),
        keyPoints: generateStubKeyPoints(language),
        language,
        createdAt: now(),
      });
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
      const explanationResult = shouldGenerateExplanation
        ? await generateExplanation(abstract, language, config)
        : undefined;

      return c.json({
        paperId,
        // 要約がない場合は空文字列を返す（説明文のみ生成の場合）
        summary: summaryResult?.summary ?? "",
        keyPoints: summaryResult?.keyPoints ?? [],
        ...(explanationResult && {
          explanation: explanationResult.explanation,
          targetAudience: explanationResult.targetAudience,
          whyRead: explanationResult.whyRead,
        }),
        language,
        createdAt: now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
