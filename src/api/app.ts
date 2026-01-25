import { Hono } from "hono";
import { logger } from "hono/logger";
import { createAuthMiddleware } from "./middleware/auth";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { categoriesApp } from "./routes/categories";
import { embeddingApp } from "./routes/embedding";
import { healthApp } from "./routes/health";
import { searchApp } from "./routes/search";
import { summaryApp } from "./routes/summary";
import { syncApp } from "./routes/sync";
import type { Env } from "./types/env";

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 */
export const createApp = () => {
  const authMiddleware = createAuthMiddleware();
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();

  // チェーン形式で構築することで、すべてのルート情報が型に含まれる
  return new Hono<{ Bindings: Env }>()
    .use("*", logger())
    .use("*", securityHeadersMiddleware)
    .route("/", healthApp)
    .use("/api/v1/*", authMiddleware)
    .route("/api/v1", categoriesApp)
    .route("/api/v1", embeddingApp)
    .route("/api/v1", searchApp)
    .route("/api/v1", summaryApp)
    .route("/api/v1", syncApp);
};

export type AppType = ReturnType<typeof createApp>;
