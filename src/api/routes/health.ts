import { Hono } from "hono";
import { z } from "zod";
import { now, toISOString } from "../../shared/utils/dateTime.js";
import type { Env } from "../types/env.js";

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
export const healthApp = new Hono<{ Bindings: Env }>().get("/health", (c) => {
  return c.json(
    {
      status: "ok" as const,
      timestamp: toISOString(now()),
    },
    200
  );
});
