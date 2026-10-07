import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { EmbeddingBatchRequestSchema, EmbeddingRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import { toStageError, UPSTREAM_ERROR_STATUS } from "../lib/upstreamError";
import {
  createEmbedding,
  createEmbeddingsBatch,
  EMBEDDING_MODEL,
  getOpenAIConfig,
} from "../services/openai";
import type { Env } from "../types/env";

/** 失敗時に error として返す固定文言（上流のエラー文の代わり） */
const EMBEDDING_FAILED_MESSAGE = "Embeddingの生成に失敗しました";

/**
 * Embedding 生成エラーを、上流のエラー文を含まない分類とステータスへ変換する。
 * クライアントが「設定を直す（401）」「待つ（429）」「再試行する（500）」を区別できるようにする。
 */
const toEmbeddingErrorResponse = (error: unknown) => {
  const stageError = toStageError(error);
  return {
    body: { error: EMBEDDING_FAILED_MESSAGE, ...stageError },
    status: UPSTREAM_ERROR_STATUS[stageError.code],
  };
};

/**
 * Embedding API アプリケーション
 */
export const embeddingApp = new Hono<{ Bindings: Env }>()
  .post("/embedding", zValidator("json", EmbeddingRequestSchema), async (c) => {
    const startTime = timestamp();
    const body = c.req.valid("json");

    try {
      const config = getOpenAIConfig(c);
      const result = await createEmbedding(body.text, config);

      return c.json(
        {
          embedding: result.embedding,
          model: EMBEDDING_MODEL,
          took: measureTime(startTime),
        },
        200
      );
    } catch (error) {
      const { body: errorBody, status } = toEmbeddingErrorResponse(error);
      return c.json(errorBody, status);
    }
  })
  .post("/embedding/batch", zValidator("json", EmbeddingBatchRequestSchema), async (c) => {
    const startTime = timestamp();
    const body = c.req.valid("json");

    try {
      const config = getOpenAIConfig(c);
      const result = await createEmbeddingsBatch(body.texts, config);

      return c.json(
        {
          embeddings: result.embeddings,
          model: EMBEDDING_MODEL,
          took: measureTime(startTime),
        },
        200
      );
    } catch (error) {
      const { body: errorBody, status } = toEmbeddingErrorResponse(error);
      return c.json(errorBody, status);
    }
  });
