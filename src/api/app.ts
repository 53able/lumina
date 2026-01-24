import { Hono } from "hono";
import { logger } from "hono/logger";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { categoriesApp } from "./routes/categories.js";
import { embeddingApp } from "./routes/embedding.js";
import { healthApp } from "./routes/health.js";
import { searchApp } from "./routes/search.js";
import { summaryApp } from "./routes/summary.js";
import { syncApp } from "./routes/sync.js";

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 *
 * @returns Honoアプリインスタンス
 */
export const createApp = () => {
  const authMiddleware = createAuthMiddleware();
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();

  const app = new Hono()
    .use("*", logger())
    .use("*", securityHeadersMiddleware)
    .route("/", healthApp)
    .use("/api/v1/*", authMiddleware)
    .route("/", categoriesApp)
    .route("/", embeddingApp)
    .route("/", searchApp)
    .route("/", summaryApp)
    .route("/", syncApp);

  return app;
};

export type AppType = ReturnType<typeof createApp>;
