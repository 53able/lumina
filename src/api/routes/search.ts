import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type ExpandedQuery,
  SearchRequestSchema,
  SearchResponseSchema,
} from "../../shared/schemas";
import { createEmbedding, expandQuery, getOpenAIConfig } from "../services/openai";

/**
 * 検索APIのルート定義
 */
export const searchRoute = createRoute({
  method: "post",
  path: "/api/v1/search",
  tags: ["search"],
  summary: "セマンティック検索",
  description:
    "クエリをAIで拡張し、検索用Embeddingを生成します。実際の検索はクライアント側で行います。",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SearchRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SearchResponseSchema,
        },
      },
      description: "検索準備成功",
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
 * スタブ用のクエリ拡張を生成（APIキーがない場合のフォールバック）
 */
const generateStubExpandedQuery = (query: string): ExpandedQuery => {
  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(query);

  return {
    original: query,
    english: isJapanese ? `[translated] ${query}` : query,
    synonyms: ["related term 1", "related term 2"],
    searchText: `${query} related term 1 related term 2`,
  };
};

/**
 * 検索APIアプリケーション
 */
export const searchApp = new OpenAPIHono();

searchApp.openapi(searchRoute, async (c) => {
  const startTime = Date.now();
  const body = c.req.valid("json");

  try {
    const config = getOpenAIConfig(c);

    // 1. クエリ拡張
    const expandedQuery = await expandQuery(body.query, config);

    // 2. 拡張クエリのEmbedding生成（searchTextを使用）
    const embeddingResult = await createEmbedding(expandedQuery.searchText, config);

    const response = {
      results: [], // クライアント側でローカル検索を実行
      expandedQuery,
      queryEmbedding: embeddingResult.embedding,
      took: Date.now() - startTime,
    };

    return c.json(response, 200);
  } catch (error) {
    // APIキーがない場合はスタブを返す
    if (error instanceof Error && error.message.includes("API key")) {
      const expandedQuery = generateStubExpandedQuery(body.query);
      const response = {
        results: [],
        expandedQuery,
        took: Date.now() - startTime,
      };
      return c.json(response, 200);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});
