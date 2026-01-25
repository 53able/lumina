import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

/**
 * 開発用APIサーバーのエントリーポイント
 *
 * @hono/node-server を使用して、独立したNode.jsサーバーとして起動する。
 * 開発環境では、このサーバーをポート3000で起動し、
 * Vite開発サーバー（ポート5173）からプロキシ経由でアクセスする。
 */
const app = createApp();
const port = 3000;

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`🚀 API Server is running on http://localhost:${info.port}`);
});
