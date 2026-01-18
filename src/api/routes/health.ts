import { Hono } from "hono";
import { z } from "zod";

/**
 * ヘルスチェックのレスポンススキーマ
 */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

/**
 * ヘルスチェック用 Hono アプリ
 */
export const healthApp = new Hono().get("/health", (c) => {
  return c.json({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  });
});
