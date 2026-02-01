import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Paper } from "../../shared/schemas/index";
import { EMBEDDING_BATCH_MAX_SIZE, SyncRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import { fetchArxivPapers } from "../services/arxivFetcher";
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
      // period は必ず渡し、母数（totalResults）を同期期間・カテゴリで絞る（未送信時は "7"）
      const effectivePeriod = body.period ?? "7";
      const arxivResult = await fetchArxivPapers({
        categories: body.categories,
        maxResults: body.maxResults ?? 50,
        start: body.start ?? 0,
        period: effectivePeriod,
      });

      // 2. APIキーがある場合はバッチで Embedding を生成（1リクエストあたり最大 EMBEDDING_BATCH_MAX_SIZE 件）
      const papersWithEmbedding = await (async (): Promise<Paper[]> => {
        try {
          const config = getOpenAIConfig(c);
          const results: Paper[] = [];
          for (let i = 0; i < arxivResult.papers.length; i += EMBEDDING_BATCH_MAX_SIZE) {
            const chunk = arxivResult.papers.slice(i, i + EMBEDDING_BATCH_MAX_SIZE);
            const chunkResults = await generatePapersEmbeddingsBatch(chunk, config);
            results.push(...chunkResults);
          }
          return results;
        } catch {
          return arxivResult.papers;
        }
      })();

      return c.json({
        papers: papersWithEmbedding,
        fetchedCount: papersWithEmbedding.length,
        totalResults: arxivResult.totalResults,
        took: measureTime(startTime),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
