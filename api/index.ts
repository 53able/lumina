import { handle } from "hono/vercel";
import { createApp } from "../src/api/app";

const app = createApp();

// Vercel Functions 用エクスポート
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "../src/api/app";
