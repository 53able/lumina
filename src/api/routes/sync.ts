import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Paper } from "../../shared/schemas/index.js";
import { SyncRequestSchema } from "../../shared/schemas/index.js";
import { fetchArxivPapers } from "../services/arxivFetcher.js";
import { createEmbedding, getOpenAIConfig, type OpenAIConfig } from "../services/openai.js";

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
 * 同期 API アプリケーション
 */
export const syncApp = new Hono().post(
  "/api/v1/sync",
  zValidator("json", SyncRequestSchema),
  async (c) => {
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

      return c.json({
        papers: papersWithEmbedding,
        fetchedCount: papersWithEmbedding.length,
        totalResults: arxivResult.totalResults,
        took: Date.now() - startTime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
