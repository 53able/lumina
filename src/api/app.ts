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
import { loadInitialData } from "./ssr/dataLoader.js";
import type { SSRRenderOptions } from "./ssr/renderer.js";
import { renderSSR } from "./ssr/renderer.js";

/**
 * 本番環境用のデフォルトアセットパス
 */
const PRODUCTION_ASSETS: SSRRenderOptions["assets"] = {
  css: ["/assets/index.css"],
  js: ["/assets/index.js"],
};

/**
 * createApp のオプション
 */
interface CreateAppOptions {
  /**
   * SSR用のアセットパス
   * 開発環境ではViteミドルウェア経由のパスを指定
   * 本番環境では省略可（デフォルトでビルド済みアセットを使用）
   */
  assets?: SSRRenderOptions["assets"];
}

/**
 * Hono アプリケーションの作成
 *
 * Hono RPC の型推論を有効にするため、メソッドチェーン形式で構築する。
 * これにより、フロントエンドの hc<AppType> で各ルートの入出力型が自動推論される。
 *
 * @param options - アプリケーション設定
 * @returns Honoアプリインスタンス
 */
export const createApp = (options?: CreateAppOptions) => {
  const authMiddleware = createAuthMiddleware();
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();
  const assets = options?.assets ?? PRODUCTION_ASSETS;

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

export type AppType = ReturnType<typeof createApp>;
