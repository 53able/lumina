import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { logger } from "hono/logger";
import { createAuthMiddleware } from "./middleware/auth";
import { categoriesApp } from "./routes/categories";
import { embeddingApp } from "./routes/embedding";
import { healthRoute } from "./routes/health";
import { searchApp } from "./routes/search";
import { summaryApp } from "./routes/summary";
import { syncApp } from "./routes/sync";

/**
 * Hono アプリケーションの作成
 */
export const createApp = () => {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", logger());

  // Public routes (認証不要)
  app.openapi(healthRoute, (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() }, 200);
  });

  // OpenAPI ドキュメント
  app.doc("/api/doc", {
    openapi: "3.1.0",
    info: {
      title: "Lumina API",
      version: "0.1.0",
      description: "arXiv論文検索・管理API",
    },
    servers: [{ url: "http://localhost:3000", description: "Local Development" }],
  });

  // Scalar API Reference
  app.get(
    "/api/ui",
    Scalar({
      url: "/api/doc",
      theme: "kepler",
    })
  );

  // Protected routes (認証必要)
  const authMiddleware = createAuthMiddleware();
  app.use("/api/v1/*", authMiddleware);

  // API v1 routes
  app.route("/", categoriesApp);
  app.route("/", embeddingApp);
  app.route("/", searchApp);
  app.route("/", summaryApp);
  app.route("/", syncApp);

  return app;
};

export type AppType = ReturnType<typeof createApp>;
