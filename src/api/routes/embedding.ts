import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { EmbeddingRequestSchema } from "../../shared/schemas/index.js";
import { measureTime, timestamp } from "../../shared/utils/dateTime.js";
import { createEmbedding, getOpenAIConfig } from "../services/openai.js";

/**
 * Embedding API アプリケーション
 */
export const embeddingApp = new Hono().post(
  "/embedding",
  zValidator("json", EmbeddingRequestSchema),
  async (c) => {
    const startTime = timestamp();
    const body = c.req.valid("json");

    try {
      const config = getOpenAIConfig(c);
      const result = await createEmbedding(body.text, config);

      return c.json({
        embedding: result.embedding,
        model: "text-embedding-3-small",
        took: measureTime(startTime),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);
