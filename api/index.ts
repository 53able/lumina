import { Hono } from "hono";
import { handle } from "hono/vercel";

// 最小限のテスト用アプリ
const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/v1/test", (c) => c.json({ message: "Hello from Vercel Functions!" }));

// Vercel Functions 用エクスポート
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
