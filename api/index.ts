import { handle } from "hono/vercel";
import app from "../src/api/app.js";

/**
 * Vercel Edge Functions 用ハンドラ
 *
 * Hono は Edge Runtime に最適化されており、
 * 低レイテンシでグローバルに配信されます。
 */
export const config = {
  runtime: "edge",
};

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

// 型エクスポート（RPCクライアント用）
export type { AppType } from "../src/api/app.js";
