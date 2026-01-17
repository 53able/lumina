import { handle } from "hono/vercel";

// NOTE: Vercel Functions環境では相対パスのまま実行される
// Vercelが自動的にTypeScriptをトランスパイルする
import { createApp } from "../src/api/app.js";

const app = createApp();

// Vercel Functions 用エクスポート
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "../src/api/app";
