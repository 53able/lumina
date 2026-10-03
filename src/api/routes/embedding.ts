import { zValidator } from "@hono/zod-validator";
import { RetryError } from "ai";
import { Hono } from "hono";
import { EmbeddingBatchRequestSchema, EmbeddingRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import {
  createEmbedding,
  createEmbeddingsBatch,
  EMBEDDING_MODEL,
  getOpenAIConfig,
  OpenAIApiKeyNotConfiguredError,
} from "../services/openai";
import type { Env } from "../types/env";

/**
 * Embedding 生成エラーを HTTP ステータスへ対応づける。
 * クライアントが「設定を直す（401/403）」「待つ（429）」「再試行する（500）」を区別できるようにする。
 */
const toEmbeddingErrorStatus = (error: unknown): 401 | 403 | 429 | 500 => {
  if (error instanceof OpenAIApiKeyNotConfiguredError) return 401;
  // AI SDK は 429 などを再試行し、上限到達時は RetryError に包んで投げる（statusCode は lastError 側）
  const source = RetryError.isInstance(error) ? error.lastError : error;
  const statusCode =
    source && typeof source === "object" && "statusCode" in source
      ? (source as { statusCode: unknown }).statusCode
      : undefined;
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) return statusCode;
  return 500;
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
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, toEmbeddingErrorStatus(error));
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
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, toEmbeddingErrorStatus(error));
    }
  });
