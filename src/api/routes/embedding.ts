import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { EmbeddingBatchRequestSchema, EmbeddingRequestSchema } from "../../shared/schemas/index";
import { measureTime, timestamp } from "../../shared/utils/dateTime";
import {
  createEmbedding,
  createEmbeddingsBatch,
  EMBEDDING_MODEL,
  getOpenAIConfig,
} from "../services/openai";
import type { Env } from "../types/env";

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
      return c.json({ error: message }, 500);
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
      return c.json({ error: message }, 500);
    }
  });
