import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Paper } from "../../shared/schemas.js";
import { SyncRequestSchema, SyncResponseSchema } from "../../shared/schemas.js";
import { fetchArxivPapers } from "../services/arxivFetcher.js";
import { createEmbedding, getOpenAIConfig, type OpenAIConfig } from "../services/openai.js";

/**
 * 同期APIのルート定義
 */
export const syncRoute = createRoute({
  method: "post",
  path: "/api/v1/sync",
  tags: ["sync"],
  summary: "arXiv論文の同期",
  description:
    "指定されたカテゴリでarXiv論文を取得し、Embeddingを生成します。クライアントは返されたデータをIndexedDBに保存します。",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SyncRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
      description: "同期成功",
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
 * 論文にEmbeddingを生成して付与する
 */
const generatePaperEmbedding = async (paper: Paper, config: OpenAIConfig): Promise<Paper> => {
  // タイトルとアブストラクトを結合してEmbeddingを生成
  const text = `${paper.title}\n\n${paper.abstract}`;
  const result = await createEmbedding(text, config);

  return {
    ...paper,
    embedding: result.embedding,
  };
};

/**
 * 同期APIアプリケーション
 */
export const syncApp = new OpenAPIHono();

syncApp.openapi(syncRoute, async (c) => {
  const startTime = Date.now();
  const body = c.req.valid("json");

  try {
    // 1. arXivから論文データを取得（startでページング）
    const arxivResult = await fetchArxivPapers({
      categories: body.categories,
      maxResults: body.maxResults ?? 50,
      start: body.start ?? 0,
    });

    // 2. APIキーがある場合はEmbeddingを生成（並列処理は課金考慮で逐次実行）
    const papersWithEmbedding = await (async (): Promise<Paper[]> => {
      try {
        const config = getOpenAIConfig(c);
        const results: Paper[] = [];
        for (const paper of arxivResult.papers) {
          const paperWithEmbedding = await generatePaperEmbedding(paper, config);
          results.push(paperWithEmbedding);
        }
        return results;
      } catch {
        // APIキーがない場合はEmbeddingなしで返す
        return arxivResult.papers;
      }
    })();

    const response = {
      papers: papersWithEmbedding,
      fetchedCount: papersWithEmbedding.length,
      totalResults: arxivResult.totalResults,
      took: Date.now() - startTime,
    };

    return c.json(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});
