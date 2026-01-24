import { Hono } from "hono";
import { logger } from "hono/logger";
import { reactRenderer } from "@hono/react-renderer";
import type { Env } from "./types/env";
import { createAuthMiddleware } from "./middleware/auth";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { categoriesApp } from "./routes/categories";
import { embeddingApp } from "./routes/embedding";
import { healthApp } from "./routes/health";
import { searchApp } from "./routes/search";
import { summaryApp } from "./routes/summary";
import { syncApp } from "./routes/sync";

/**
 * Hono アプリケーションの作成
 */
export const createApp = () => {
  const authMiddleware = createAuthMiddleware();
  const securityHeadersMiddleware = createSecurityHeadersMiddleware();

  const app = new Hono<{ Bindings: Env }>()
    .use("*", logger())
    .use("*", securityHeadersMiddleware);

  // SSR 用のレンダラー設定
  app.use(
    "*",
    reactRenderer(({ children }, c) => {
      const isProd = import.meta.env?.PROD || c.env?.NODE_ENV === "production";
      const assets = isProd
        ? {
            css: "/assets/index.css",
            js: "/assets/index.js",
          }
        : {
            css: "/src/client/index.css",
            js: "/src/client/main.tsx",
          };

      return (
        <html lang="ja">
          <head>
            <meta charSet="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Lumina</title>
            <link rel="icon" type="image/svg+xml" href="/lumina.svg" />
            <link rel="stylesheet" href={assets.css} />
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
              href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
              rel="stylesheet"
            />
            {isProd ? null : (
              <script type="module" src="/@vite/client" />
            )}
          </head>
          <body>
            <div id="root">{children}</div>
            <script type="module" src={assets.js} />
          </body>
        </html>
      );
    })
  );

  app.route("/", healthApp);

  // API v1 ルートを統合
  const apiV1 = new Hono<{ Bindings: Env }>()
    .use("*", authMiddleware)
    .route("/", categoriesApp)
    .route("/", embeddingApp)
    .route("/", searchApp)
    .route("/", summaryApp)
    .route("/", syncApp);

  app.route("/api/v1", apiV1);

  // SSR ルート: API 以外のすべての GET リクエストで空の HTML (root div) を返し、クライアントサイドでマウントさせる
  // 最小構成のため、まずはサーバー側での完全な React レンダリングは行わず、ハイドレーションの準備を整える
  app.get("*", (c) => {
    return c.render(<></>);
  });

  return app;
};

const app = createApp();
export default app;
export type AppType = ReturnType<typeof createApp>;
