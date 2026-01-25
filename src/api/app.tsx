import { Hono } from "hono";
import { logger } from "hono/logger";
import { reactRenderer } from "@hono/react-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StaticRouter } from "react-router";
import { App } from "../client/App";
import { InteractionProvider } from "../client/contexts/InteractionContext";
import type { Env } from "./types/env";
import { createAuthMiddleware } from "./middleware/auth";
import { createSecurityHeadersMiddleware } from "./middleware/securityHeaders";
import { categoriesApp } from "./routes/categories";
import { embeddingApp } from "./routes/embedding";
import { healthApp } from "./routes/health";
import { searchApp } from "./routes/search";
import { summaryApp } from "./routes/summary";
import { syncApp } from "./routes/sync";
import { loadInitialData, type InitialData } from "./ssr/dataLoader";

declare module "hono" {
  interface ContextRenderer {
    (children: React.ReactNode, props?: { initialData?: InitialData; pathname?: string }): Promise<Response>;
  }
}

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
    reactRenderer(({ children, c, ...props }) => {
      const { initialData, pathname } = props as { initialData?: InitialData; pathname?: string };
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

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      });

      const currentPathname = pathname ?? new URL(c.req.url).pathname;

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
            {initialData && (
              <script
                dangerouslySetInnerHTML={{
                  __html: `window.__INITIAL_DATA__ = ${JSON.stringify(initialData)};`,
                }}
              />
            )}
          </head>
          <body>
            <div id="root">
              <StaticRouter location={currentPathname}>
                <QueryClientProvider client={queryClient}>
                  <InteractionProvider>
                    <App />
                  </InteractionProvider>
                </QueryClientProvider>
              </StaticRouter>
            </div>
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

  // SSR ルート
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const pathname = url.pathname;

    // APIルートと静的アセットはスキップ
    if (pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
      return c.notFound();
    }

    // 初期データを取得
    const initialData = await loadInitialData(app as any, c, pathname);

    return c.render(<></>, { initialData, pathname });
  });

  return app;
};

const app = createApp();
export default app;
export type AppType = ReturnType<typeof createApp>;
