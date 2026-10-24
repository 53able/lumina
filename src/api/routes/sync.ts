import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Paper } from "../../shared/schemas/index.js";
import { EMBEDDING_BATCH_MAX_SIZE, SyncRequestSchema } from "../../shared/schemas/index.js";
import { measureTime, timestamp } from "../../shared/utils/dateTime.js";
import { getLogger } from "../lib/logger.js";
import { toStageError } from "../lib/upstreamError.js";
import {
  ArxivRateLimitError,
  ArxivServiceUnavailableError,
  fetchArxivPapers,
} from "../services/arxivFetcher.js";
import {
  createEmbeddingsBatch,
  getOpenAIConfig,
  OpenAIApiKeyNotConfiguredError,
  type OpenAIConfig,
} from "../services/openai.js";
import type { AppEnv } from "../types/env.js";

/**
 * Embedding 生成に使える時間（リクエスト開始から）。maxDuration 60 秒に対し、超えたら残りは Embedding なしで返す。
 * 欠けた Embedding はクライアントの補完で後から埋まる
 */
const SYNC_EMBEDDING_TIME_BUDGET_MS = 40_000;

/**
 * Embedding 生成を打ち切る時刻（リクエスト開始から）。予算内に始めた最後のチャンクも、これを超えたら中断する
 */
const SYNC_EMBEDDING_DEADLINE_MS = 50_000;

/**
 * 論文配列をバッチで Embedding 生成し、各論文に付与する
 */
const generatePapersEmbeddingsBatch = async (
  papers: Paper[],
  config: OpenAIConfig,
  abortSignal: AbortSignal
): Promise<Paper[]> => {
  if (papers.length === 0) return [];
  const texts = papers.map((p) => `${p.title}\n\n${p.abstract}`);
  // 再試行の待ちで締め切りを超えないよう、sync では再試行しない（欠けた分はクライアントの補完で埋まる）
  const { embeddings } = await createEmbeddingsBatch(texts, config, { abortSignal, maxRetries: 0 });
  return papers.map((paper, i) => ({ ...paper, embedding: embeddings[i] }));
};

/**
 * 同期 API アプリケーション
 */
export const syncApp = new Hono<AppEnv>().post(
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
        ...(body.fromDate != null ? { fromDate: body.fromDate } : {}),
        ...(body.toDate != null ? { toDate: body.toDate } : {}),
      });

      const existingIdSet =
        body.existingPaperIds && body.existingPaperIds.length > 0
          ? new Set(body.existingPaperIds)
          : new Set<string>();

      // 2. APIキーがある場合は新規論文のみバッチで Embedding を生成（既存IDはスキップ）
      //    skipEmbedding 指定時（クライアントで API 利用 OFF）は生成しない
      const papersWithEmbedding = await (async (): Promise<Paper[]> => {
        if (body.skipEmbedding) return arxivResult.papers;
        try {
          const config = getOpenAIConfig(c);
          const abortSignal = AbortSignal.timeout(
            Math.max(0, SYNC_EMBEDDING_DEADLINE_MS - measureTime(startTime))
          );
          const results: Paper[] = [];
          for (let i = 0; i < arxivResult.papers.length; i += EMBEDDING_BATCH_MAX_SIZE) {
            if (measureTime(startTime) > SYNC_EMBEDDING_TIME_BUDGET_MS) {
              // 時間予算を超えたため、残りは Embedding なしで返す
              results.push(...arxivResult.papers.slice(i).map((paper) => ({ ...paper })));
              break;
            }
            const chunk = arxivResult.papers.slice(i, i + EMBEDDING_BATCH_MAX_SIZE);
            const newInChunk = chunk.filter((p) => !existingIdSet.has(p.id));
            let withEmbedding: Paper[];
            try {
              withEmbedding =
                newInChunk.length > 0
                  ? await generatePapersEmbeddingsBatch(newInChunk, config, abortSignal)
                  : [];
            } catch (error) {
              getLogger(c).warn(
                {
                  chunkStart: i,
                  elapsedMs: measureTime(startTime),
                  code: toStageError(error).code,
                  err: error,
                },
                "sync embedding stopped"
              );
              // 締め切り・上流の失敗では、生成済みの分を残して残りを Embedding なしで返す
              results.push(...arxivResult.papers.slice(i).map((paper) => ({ ...paper })));
              break;
            }
            const embeddingById = new Map(withEmbedding.map((paper) => [paper.id, paper]));
            const ordered = chunk.map((paper) =>
              existingIdSet.has(paper.id)
                ? { ...paper }
                : (embeddingById.get(paper.id) ?? { ...paper })
            );
            results.push(...ordered);
          }
          return results;
        } catch (error) {
          // キー未設定は利用者の設定の問題なので debug。それ以外の失敗は warn
          if (error instanceof OpenAIApiKeyNotConfiguredError) {
            getLogger(c).debug(
              { code: toStageError(error).code, err: error },
              "sync embedding skipped"
            );
          } else {
            getLogger(c).warn(
              { code: toStageError(error).code, err: error },
              "sync embedding skipped"
            );
          }
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
      // 上流の本文・待ち時間・例外の詳細はログにだけ出し、応答は固定の文言にする
      const logger = getLogger(c);
      if (error instanceof ArxivRateLimitError) {
        logger.warn({ code: "rate_limit", bodyStart: body.start, err: error }, "sync failed");
        const headers: Record<string, string> = {};
        if (error.retryAfterSec != null && Number.isFinite(error.retryAfterSec)) {
          headers["Retry-After"] = String(Math.max(1, Math.floor(error.retryAfterSec)));
        }
        return c.json(
          { error: "arXiv is busy. Please retry later.", code: "rate_limit", retryable: true },
          429,
          headers
        );
      }
      if (error instanceof ArxivServiceUnavailableError) {
        logger.warn({ code: "upstream", bodyStart: body.start, err: error }, "sync failed");
        // arXiv の一時的な障害・タイムアウト。クライアントには短い間隔での再試行を促す
        return c.json(
          { error: "arXiv is temporarily unavailable.", code: "upstream", retryable: true },
          503,
          { "Retry-After": "5" }
        );
      }
      logger.error({ code: "internal", bodyStart: body.start, err: error }, "sync failed");
      return c.json({ error: "Sync failed.", code: "internal", retryable: false }, 500);
    }
  }
);
