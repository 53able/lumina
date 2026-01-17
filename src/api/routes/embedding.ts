import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { EmbeddingRequestSchema, EmbeddingResponseSchema } from "../../shared/schemas/index.js";
import { createEmbedding, getOpenAIConfig } from "../services/openai.js";

/**
 * Embedding生成のルート定義
 */
export const embeddingRoute = createRoute({
  method: "post",
  path: "/api/v1/embedding",
  tags: ["embedding"],
  summary: "Embedding生成",
  description: "テキストからEmbeddingベクトルを生成します",
  request: {
    body: {
      content: {
        "application/json": {
          schema: EmbeddingRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: EmbeddingResponseSchema,
        },
      },
      description: "Embedding生成成功",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "バリデーションエラー",
    },
    500: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "サーバーエラー",
    },
  },
});

/**
 * Embedding APIアプリケーション
 */
export const embeddingApp = new OpenAPIHono();

embeddingApp.openapi(embeddingRoute, async (c) => {
  const startTime = Date.now();
  const body = c.req.valid("json");

  try {
    const config = getOpenAIConfig(c);
    const result = await createEmbedding(body.text, config);

    const response = {
      embedding: result.embedding,
      model: "text-embedding-3-small",
      took: Date.now() - startTime,
    };

    return c.json(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});
