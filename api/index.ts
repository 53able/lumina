/**
 * Vercel Functions エントリーポイント
 *
 * Vercelが直接このファイルをビルドしてFunctionとして認識する。
 * tsupバンドルの代わりに、Vercelのビルトインバンドラーを使用。
 */
import { handle } from "hono/vercel";
import { createApp } from "../src/api/app.js";

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
