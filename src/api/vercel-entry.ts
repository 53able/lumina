/**
 * Vercel Functions エントリーポイント
 *
 * tsup でバンドルされ、api/index.js として出力される。
 * Vercel が自動的にこのファイルを Edge Function として認識する。
 */
import { handle } from "hono/vercel";
import { createApp } from "./app.js";

/**
 * Edge Functions 設定
 *
 * @see https://vercel.com/docs/functions/runtimes/edge-runtime
 */
export const config = {
	runtime: "edge",
};

const app = createApp();

/**
 * Vercel Functions 用ハンドラ
 *
 * - GET: SSRルート（/*）とAPIルート（/api/*）の両方を処理
 * - POST/PUT/DELETE/PATCH: APIルート（/api/*）を処理
 */
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "./app.js";
