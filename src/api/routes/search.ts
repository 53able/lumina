import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type ExpandedQuery, SearchRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import { createEmbedding, expandQuery, getOpenAIConfig } from "../services/openai";
import type { Env } from "../types/env";

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
 * 利用者が指定した検索文をそのまま Embedding に使う場合の拡張クエリ
 * （クエリ拡張を行わないため、英訳・関連語は持たない）
 */
const toDirectExpandedQuery = (query: string, embeddingText: string): ExpandedQuery => ({
  original: query,
  english: query,
  synonyms: [],
  searchText: embeddingText,
});

/**
 * 検索 API アプリケーション
 *
 * embeddingText が指定された場合はクエリ拡張を省き、その文を Embedding に渡す。
 */
export const searchApp = new Hono<{ Bindings: Env }>().post(
  "/search",
  zValidator("json", SearchRequestSchema),
  async (c) => {
    const startTime = timestamp();
    const body = c.req.valid("json");

    try {
      const config = getOpenAIConfig(c);

      // 1. クエリ拡張（利用者が検索文を指定した場合は省く）
      const expandedQuery =
        body.embeddingText !== undefined
          ? toDirectExpandedQuery(body.query, body.embeddingText)
          : await expandQuery(body.query, config);

      // 2. 拡張クエリのEmbedding生成（searchTextを使用）
      const embeddingResult = await createEmbedding(expandedQuery.searchText, config);

      return c.json(
        {
          results: [], // クライアント側でローカル検索を実行
          expandedQuery,
          queryEmbedding: embeddingResult.embedding,
          took: measureTime(startTime),
        },
        200
      );
    } catch (error) {
      // APIキーがない場合はスタブを返す（queryEmbeddingは空配列で統一）。
      // 検索文を指定した再検索はスタブにせずエラーを返す（実際に Embedding できなかったことを隠さない）
      if (
        body.embeddingText === undefined &&
        error instanceof Error &&
        error.message.includes("API key")
      ) {
        const expandedQuery = generateStubExpandedQuery(body.query);
        return c.json(
          {
            results: [],
            expandedQuery,
            queryEmbedding: [],
            took: measureTime(startTime),
          },
          200
        );
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
