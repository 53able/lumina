import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getLogger, type Logger, rootLogger } from "./lib/logger.js";
import {
  createApiRateLimitMiddleware,
  createSyncRateLimitMiddleware,
  SYNC_PATH,
} from "./middleware/rateLimit.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { categoriesApp } from "./routes/categories.js";
import { embeddingApp } from "./routes/embedding.js";
import { healthApp } from "./routes/health.js";
import { searchApp } from "./routes/search.js";
import { summaryApp } from "./routes/summary.js";
import { syncApp } from "./routes/sync.js";
import type { AppEnv } from "./types/env.js";

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 *
 * @param options.logger - アクセスログとルートのログに使うロガー（テストではメモリの sink を持つものを渡す）
 */
export const createApp = ({ logger = rootLogger }: { logger?: Logger } = {}) => {
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();
  const syncRateLimitMiddleware = createSyncRateLimitMiddleware();
  const apiRateLimitMiddleware = createApiRateLimitMiddleware();

  // チェーン形式で構築することで、すべてのルート情報が型に含まれる
  return new Hono<AppEnv>()
    .use("*", requestLogger(logger))
    .use("*", securityHeadersMiddleware)
    .use(SYNC_PATH, syncRateLimitMiddleware)
    .use("/api/v1/*", apiRateLimitMiddleware)
    .route("/", healthApp)
    .route("/api/v1", categoriesApp)
    .route("/api/v1", embeddingApp)
    .route("/api/v1", searchApp)
    .route("/api/v1", summaryApp)
    .route("/api/v1", syncApp)
    .onError((err, c) => {
      // HTTPException は Hono の既定と同じく、その応答を返す
      if (err instanceof HTTPException) {
        const res = err.getResponse();
        return c.newResponse(res.body, res);
      }
      // Hono の既定の errorHandler（標準エラーへの出力）を通さず、例外の詳細はロガーにだけ出す
      getLogger(c).error({ code: "internal", err }, "unhandled error");
      return c.json({ error: "Internal Server Error" }, 500);
    });
};

export type AppType = ReturnType<typeof createApp>;
