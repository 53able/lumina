import { handle } from "hono/vercel";
// NOTE: api/フォルダはビルド時にコンパイルされるため、
// コンパイル済みの ../src/api/app.js をインポート
import { createApp } from "../src/api/app.js";
const app = createApp();
// Vercel Functions 用エクスポート
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
