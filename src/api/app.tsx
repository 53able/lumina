/// <reference types="vite/client" />
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env } from "./types/env";
// import { createAuthMiddleware } from "./middleware/auth";
// import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders";
// import { categoriesApp } from "./routes/categories";
// import { embeddingApp } from "./routes/embedding";
// import { healthApp } from "./routes/health";
// import { searchApp } from "./routes/search";
// import { summaryApp } from "./routes/summary";
// import { syncApp } from "./routes/sync";
// import { renderToString } from "react-dom/server.edge";
// import React from "react";
// import { HtmlTemplate } from "./ssr/html";

/**
 * SSR用のアセットパス定義
 */
const ASSETS = {
  production: {
    css: ["/assets/index.css"],
    js: ["/assets/index.js"],
  },
  development: {
    css: ["/src/client/index.css"],
    js: ["/src/client/main.tsx"],
  },
} as const satisfies Record<string, { css: string[]; js: string[] }>;

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 *
 * @returns Honoアプリインスタンス
 */
export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>()
    .use("*", logger());

  // API v1 ルートを統合
  const apiV1 = new Hono<{ Bindings: Env }>();

  app.route("/api/v1", apiV1);

  // SSRルート: APIルートと静的アセット以外のすべてのリクエストを処理
  app.get("*", async (c) => {
    return c.text("Lumina API (Debug Mode)");
  });

  return app;
};

  return app;
};

const app = createApp();

export default app;

export type AppType = ReturnType<typeof createApp>;
