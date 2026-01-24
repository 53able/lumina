/// <reference types="vite/client" />
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env } from "./types/env";
import { createAuthMiddleware } from "./middleware/auth";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { categoriesApp } from "./routes/categories";
// import { embeddingApp } from "./routes/embedding";
import { healthApp } from "./routes/health";
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
  const authMiddleware = createAuthMiddleware();
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();

  const app = new Hono<{ Bindings: Env }>()
    .use("*", logger())
    .use("*", securityHeadersMiddleware)
    .route("/", healthApp);

  // API v1 ルートを統合
  const apiV1 = new Hono<{ Bindings: Env }>()
    .use("*", authMiddleware)
    .route("/", categoriesApp);
    // 一時的に AI 関連のルートをコメントアウト（デプロイエラー調査のため）
    // .route("/", embeddingApp)
    // .route("/", searchApp)
    // .route("/", summaryApp)
    // .route("/", syncApp);

  app.route("/api/v1", apiV1);

  // SSRルート: APIルートと静的アセット以外のすべてのリクエストを処理
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // APIルートと静的アセットはスキップ（既存のルートで処理）
    if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
      return c.notFound();
    }

    // 環境に応じてアセットを切り替え
    const isProd = import.meta.env?.PROD || c.env.NODE_ENV === "production";
    const assets = isProd ? ASSETS.production : ASSETS.development;

    // SPAモード: SSRをせずに、共通のHTMLテンプレートを返す
    // クライアント側でハイドレーションではなくマウントが行われる
    const html = `
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lumina</title>
    ${assets.css.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}
  </head>
  <body>
    <div id="root"></div>
    ${assets.js.map((s) => `<script type="module" src="${s}"></script>`).join("")}
  </body>
</html>`;
    return c.html(`<!doctype html>${html}`);
  });

  return app;
};

const app = createApp();

export default app;

export type AppType = ReturnType<typeof createApp>;
