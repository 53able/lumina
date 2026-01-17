import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { PaperSummarySchema } from "../../shared/schemas/index.js";
import { generateExplanation, generateSummary, getOpenAIConfig } from "../services/openai.js";
/**
 * 生成対象の種類
 * - summary: 要約のみ
 * - explanation: 説明文のみ（既存の要約がある場合）
 * - both: 要約と説明文の両方
 */
const GenerateTargetSchema = z.enum(["summary", "explanation", "both"]);
/**
 * 要約リクエストのスキーマ
 */
const SummaryRequestSchema = z.object({
    /** 要約の言語 */
    language: z.enum(["ja", "en"]),
    /** 論文のアブストラクト（クライアント側から渡される） */
    abstract: z.string().min(1).optional(),
    /** 生成対象（デフォルト: summary のみ） */
    generateTarget: GenerateTargetSchema.optional().default("summary"),
    /** @deprecated includeExplanation は generateTarget に置き換え */
    includeExplanation: z.boolean().optional(),
});
/**
 * 要約APIのルート定義
 */
export const summaryRoute = createRoute({
    method: "post",
    path: "/api/v1/summary/{id}",
    tags: ["summary"],
    summary: "論文要約生成",
    description: "指定された論文のアブストラクトを要約し、キーポイントを抽出します。abstractを指定しない場合はスタブ要約を返します。",
    request: {
        params: z.object({
            id: z
                .string()
                .min(1)
                .openapi({
                param: {
                    name: "id",
                    in: "path",
                },
                description: "arXiv論文ID",
                example: "2401.12345",
            }),
        }),
        body: {
            content: {
                "application/json": {
                    schema: SummaryRequestSchema,
                },
            },
            required: true,
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: PaperSummarySchema,
                },
            },
            description: "要約生成成功",
        },
        400: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "バリデーションエラー",
        },
        500: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "サーバーエラー",
        },
    },
});
/**
 * スタブ用の要約を生成（abstractがない場合のフォールバック）
 */
const generateStubSummary = (paperId, language) => {
    if (language === "ja") {
        return `論文 ${paperId} の要約です。この論文では...`;
    }
    return `Summary of paper ${paperId}. This paper presents...`;
};
/**
 * スタブ用のキーポイントを生成
 */
const generateStubKeyPoints = (language) => {
    if (language === "ja") {
        return ["キーポイント1", "キーポイント2", "キーポイント3"];
    }
    return ["Key point 1", "Key point 2", "Key point 3"];
};
/**
 * 要約APIアプリケーション
 */
export const summaryApp = new OpenAPIHono();
summaryApp.openapi(summaryRoute, async (c) => {
    const { id: paperId } = c.req.valid("param");
    const { language, abstract, generateTarget, includeExplanation } = c.req.valid("json");
    // 後方互換性: includeExplanation が true なら generateTarget を "both" に
    const target = includeExplanation === true ? "both" : (generateTarget ?? "summary");
    // abstractがない場合はスタブを返す
    if (!abstract) {
        const response = {
            paperId,
            summary: generateStubSummary(paperId, language),
            keyPoints: generateStubKeyPoints(language),
            language,
            createdAt: new Date(),
        };
        return c.json(response, 200);
    }
    try {
        const config = getOpenAIConfig(c);
        // 生成対象に応じて処理を分岐
        const shouldGenerateSummary = target === "summary" || target === "both";
        const shouldGenerateExplanation = target === "explanation" || target === "both";
        // 要約生成（対象の場合のみ）
        const summaryResult = shouldGenerateSummary
            ? await generateSummary(abstract, language, config)
            : undefined;
        // 説明文生成（対象の場合のみ）
        const explanationResult = shouldGenerateExplanation
            ? await generateExplanation(abstract, language, config)
            : undefined;
        const response = {
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
            createdAt: new Date(),
        };
        return c.json(response, 200);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ error: message }, 500);
    }
});
