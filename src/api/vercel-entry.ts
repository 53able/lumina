/**
 * Vercel Functions エントリーポイント
 *
 * tsup でバンドルされ、api/index.js として出力される。
 * Node.js Functionsで動作（react-dom/serverがNode.js APIに依存するため）。
 *
 * Node.js Functionsでは export default が必要。
 * export const GET などはEdge Functions用の形式。
 */
import { handle } from "@hono/node-server/vercel";
import { createApp } from "./app.js";

import { handle } from "@hono/node-server/vercel";
import { createApp } from "./app.js";

const app = createApp();

/**
 * Vercel Node.js Functions 用ハンドラ
 */
export default handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "./app.js";
