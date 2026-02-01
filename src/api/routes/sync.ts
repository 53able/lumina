import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Paper } from "../../shared/schemas/index";
import { SyncRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import { fetchArxivPapers } from "../services/arxivFetcher";
import { createEmbedding, getOpenAIConfig, type OpenAIConfig } from "../services/openai";
import type { Env } from "../types/env";

/** 同期時の Embedding 生成の並列数上限（課金・レート制限を考慮） */
const SYNC_EMBEDDING_CONCURRENCY = 5;

/**
 * 論文にEmbeddingを生成して付与する
 */
const generatePaperEmbedding = async (paper: Paper, config: OpenAIConfig): Promise<Paper> => {
  const text = `${paper.title}\n\n${paper.abstract}`;
  const result = await createEmbedding(text, config);
  return { ...paper, embedding: result.embedding };
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

      // 2. APIキーがある場合はEmbeddingを生成（並列数上限で速度と課金のバランス）
      const papersWithEmbedding = await (async (): Promise<Paper[]> => {
        try {
          const config = getOpenAIConfig(c);
          const results: Paper[] = [];
          for (let i = 0; i < arxivResult.papers.length; i += SYNC_EMBEDDING_CONCURRENCY) {
            const chunk = arxivResult.papers.slice(i, i + SYNC_EMBEDDING_CONCURRENCY);
            const chunkResults = await Promise.all(
              chunk.map((paper) => generatePaperEmbedding(paper, config))
            );
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
