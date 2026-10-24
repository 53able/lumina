import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  createApiRateLimitMiddleware,
  createSyncRateLimitMiddleware,
  SYNC_PATH,
} from "./middleware/rateLimit.js";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { categoriesApp } from "./routes/categories.js";
import { embeddingApp } from "./routes/embedding.js";
import { healthApp } from "./routes/health.js";
import { searchApp } from "./routes/search.js";
import { summaryApp } from "./routes/summary.js";
import { syncApp } from "./routes/sync.js";
import type { Env } from "./types/env.js";

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 */
export const createApp = () => {
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();
  const syncRateLimitMiddleware = createSyncRateLimitMiddleware();
  const apiRateLimitMiddleware = createApiRateLimitMiddleware();

  // チェーン形式で構築することで、すべてのルート情報が型に含まれる
  return new Hono<{ Bindings: Env }>()
    .use("*", logger())
    .use("*", securityHeadersMiddleware)
    .use(SYNC_PATH, syncRateLimitMiddleware)
    .use("/api/v1/*", apiRateLimitMiddleware)
    .route("/", healthApp)
    .route("/api/v1", categoriesApp)
    .route("/api/v1", embeddingApp)
    .route("/api/v1", searchApp)
    .route("/api/v1", summaryApp)
    .route("/api/v1", syncApp);
};

export type AppType = ReturnType<typeof createApp>;
