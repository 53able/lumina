import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Paper } from "../../shared/schemas/index";
import { EMBEDDING_BATCH_MAX_SIZE, SyncRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import {
  ArxivRateLimitError,
  ArxivServiceUnavailableError,
  fetchArxivPapers,
} from "../services/arxivFetcher";
import { createEmbeddingsBatch, getOpenAIConfig, type OpenAIConfig } from "../services/openai";
import type { Env } from "../types/env";

/**
 * 論文配列をバッチで Embedding 生成し、各論文に付与する
 */
const generatePapersEmbeddingsBatch = async (
  papers: Paper[],
  config: OpenAIConfig
): Promise<Paper[]> => {
  if (papers.length === 0) return [];
  const texts = papers.map((p) => `${p.title}\n\n${p.abstract}`);
  const { embeddings } = await createEmbeddingsBatch(texts, config);
  return papers.map((paper, i) => ({ ...paper, embedding: embeddings[i] }));
};

/**
 * 同期 API アプリケーション
 */
export const syncApp = new Hono<{ Bindings: Env }>().post(
  "/sync",
  zValidator("json", SyncRequestSchema),
  async (c) => {
    const startTime = timestamp();
    const body = c.req.valid("json");

    try {
      // 1. arXivから論文データを取得（startでページング、期間フィルタ適用）
      // period は必ず渡し、母数（totalResults）を同期期間・カテゴリで絞る（未送信時は "1"）
      const effectivePeriod = body.period ?? "1";
      const arxivResult = await fetchArxivPapers({
        categories: body.categories,
        maxResults: body.maxResults ?? 200,
        start: body.start ?? 0,
        period: effectivePeriod,
      });

      const existingIdSet =
        body.existingPaperIds && body.existingPaperIds.length > 0
          ? new Set(body.existingPaperIds)
          : new Set<string>();

      // 2. APIキーがある場合は新規論文のみバッチで Embedding を生成（既存IDはスキップ）
      const papersWithEmbedding = await (async (): Promise<Paper[]> => {
        try {
          const config = getOpenAIConfig(c);
          const results: Paper[] = [];
          for (let i = 0; i < arxivResult.papers.length; i += EMBEDDING_BATCH_MAX_SIZE) {
            const chunk = arxivResult.papers.slice(i, i + EMBEDDING_BATCH_MAX_SIZE);
            const newInChunk = chunk.filter((p) => !existingIdSet.has(p.id));
            const withEmbedding =
              newInChunk.length > 0 ? await generatePapersEmbeddingsBatch(newInChunk, config) : [];
            const ordered = chunk.map((paper) =>
              existingIdSet.has(paper.id)
                ? { ...paper }
                : (withEmbedding.find((e) => e.id === paper.id) ?? { ...paper })
            );
            results.push(...ordered);
          }
          return results;
        } catch {
          return arxivResult.papers;
        }
      })();

      return c.json(
        {
          papers: papersWithEmbedding,
          fetchedCount: papersWithEmbedding.length,
          totalResults: arxivResult.totalResults,
          took: measureTime(startTime),
        },
        200
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (error instanceof ArxivRateLimitError) {
        const headers: Record<string, string> = {};
        if (error.retryAfterSec != null && Number.isFinite(error.retryAfterSec)) {
          headers["Retry-After"] = String(Math.max(1, Math.floor(error.retryAfterSec)));
        }
        return c.json({ error: message }, 429, headers);
      }
      if (error instanceof ArxivServiceUnavailableError) {
        return c.json({ error: message }, 503);
      }
      console.error("[sync] 500 error", { bodyStart: body.start, message }, error);
      return c.json({ error: message }, 500);
    }
  }
);
