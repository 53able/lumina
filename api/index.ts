import { handle } from "hono/vercel";
import { createApp } from "../src/api/app.js";

const app = createApp();

// Vercel Functions 用エクスポート
// GET: SSRルート（/*）とAPIルート（/api/*）の両方を処理
// POST/PUT/DELETE/PATCH: APIルート（/api/*）を処理
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "../src/api/app.js";
