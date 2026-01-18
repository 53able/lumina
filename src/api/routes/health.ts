import { Hono } from "hono";
import { z } from "zod";
import { now, toISOString } from "../../shared/utils/dateTime.js";

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
    timestamp: toISOString(now()),
  });
});
