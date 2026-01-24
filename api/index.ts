import { handle } from "hono/vercel";
import app from "../src/api/app.tsx";

export const config = {
  runtime: "edge",
};

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);

export type { AppType } from "../src/api/app";
