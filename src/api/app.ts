/// <reference types="vite/client" />
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
import { loadInitialData } from "./ssr/dataLoader";
import { renderSSR } from "./ssr/renderer";

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

  // 環境に応じてアセットを切り替え
  // Vite環境下では import.meta.env.PROD を使用
  const isProd = import.meta.env?.PROD ?? process.env.NODE_ENV === "production";
  const assets = isProd ? ASSETS.production : ASSETS.development;

  const app = new Hono()
    .use("*", logger())
    .use("*", securityHeadersMiddleware)
    .route("/", healthApp);

  // API v1 ルートを統合
  const apiV1 = new Hono()
    .use("*", authMiddleware)
    .route("/", categoriesApp)
    .route("/", embeddingApp)
    .route("/", searchApp)
    .route("/", summaryApp)
    .route("/", syncApp);

  app.route("/api/v1", apiV1);

  // SSRルート: APIルートと静的アセット以外のすべてのリクエストを処理
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // APIルートと静的アセットはスキップ（既存のルートで処理）
    if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
      return c.notFound();
    }

    try {
      // 初期データを取得
      const initialData = await loadInitialData(app, c, pathname);

      // SSRでHTMLを生成
      const html = renderSSR({
        pathname,
        initialData,
        assets,
      });

      return c.html(html);
    } catch (error) {
      console.error("[SSR] Error rendering:", error);
      // エラー時は空のHTMLを返す（クライアント側でレンダリング）
      const html = renderSSR({
        pathname,
        assets,
      });
      return c.html(html);
    }
  });

  return app;
};

const app = createApp();

export default app;

export type AppType = ReturnType<typeof createApp>;
