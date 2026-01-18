import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type ExpandedQuery, SearchRequestSchema } from "../../shared/schemas/index.js";
import { createEmbedding, expandQuery, getOpenAIConfig } from "../services/openai.js";

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
 * 検索 API アプリケーション
 */
export const searchApp = new Hono().post(
  "/api/v1/search",
  zValidator("json", SearchRequestSchema),
  async (c) => {
    const startTime = Date.now();
    const body = c.req.valid("json");

    try {
      const config = getOpenAIConfig(c);

      // 1. クエリ拡張
      const expandedQuery = await expandQuery(body.query, config);

      // 2. 拡張クエリのEmbedding生成（searchTextを使用）
      const embeddingResult = await createEmbedding(expandedQuery.searchText, config);

      return c.json({
        results: [], // クライアント側でローカル検索を実行
        expandedQuery,
        queryEmbedding: embeddingResult.embedding,
        took: Date.now() - startTime,
      });
    } catch (error) {
      // APIキーがない場合はスタブを返す（queryEmbeddingは空配列で統一）
      if (error instanceof Error && error.message.includes("API key")) {
        const expandedQuery = generateStubExpandedQuery(body.query);
        return c.json({
          results: [],
          expandedQuery,
          queryEmbedding: [],
          took: Date.now() - startTime,
        });
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
