import { APICallError } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createLogger } from "../lib/logger";

const ABSTRACT = "ABSTRACT_SECRET";
const KEY_FRAGMENT = "sk-test-SECRETabcd";

/** 本文（requestBodyValues / responseBody）とキー断片（message）を持つ 401 の APICallError */
const apiCallError = new APICallError({
  message: `Incorrect API key provided: ${KEY_FRAGMENT}`,
  url: "https://api.openai.com/v1/embeddings",
  requestBodyValues: { input: ABSTRACT },
  statusCode: 401,
  responseBody: JSON.stringify({ error: { message: `key ${KEY_FRAGMENT}`, input: ABSTRACT } }),
  isRetryable: false,
});

describe("requestLogger", () => {
  const lines: string[] = [];
  const app = createApp({
    logger: createLogger({ level: "trace", sink: { write: (line) => lines.push(line) } }),
  });
  // ルーターは最初の app.request で組み立てられ、その後はルートを足せないため、ここで足す
  app.get("/__throw", () => {
    throw apiCallError;
  });

  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const accessLogs = () => parsed().filter((line) => line.msg === "request");

  beforeEach(() => {
    lines.length = 0;
  });

  it("各行は JSON で level・time・service・msg を持ち、アクセスログは info の request で1行出る", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(lines).toHaveLength(1);
    const [line] = parsed();
    expect(line).toEqual({
      level: "info",
      time: expect.any(String),
      service: "lumina-api",
      reqId: expect.any(String),
      method: "GET",
      route: "/health",
      path: "/health",
      status: 200,
      durationMs: expect.any(Number),
      msg: "request",
    });
    expect(new Date(line?.time as string).toISOString()).toBe(line?.time);
  });

  it("x-vercel-id が英数字と : _ - の128文字以内なら reqId に入れ、合わなければ UUID にする", async () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    await app.request("/health", { headers: { "x-vercel-id": "hnd1::abc_1-x" } });
    await app.request("/health", { headers: { "x-vercel-id": "x".repeat(128) } });
    await app.request("/health", { headers: { "x-vercel-id": "x".repeat(129) } });
    await app.request("/health", { headers: { "x-vercel-id": 'hnd1::abc"},"x":"1' } });
    await app.request("/health", { headers: { "x-vercel-id": "a b" } });

    const reqIds = accessLogs().map((line) => line.reqId);
    expect(reqIds.slice(0, 2)).toEqual(["hnd1::abc_1-x", "x".repeat(128)]);
    for (const reqId of reqIds.slice(2)) expect(reqId).toMatch(uuidPattern);
  });

  it("path は256文字に切る", async () => {
    await app.request(`/${"p".repeat(300)}`);

    expect(accessLogs()[0]?.path).toBe(`/${"p".repeat(255)}`);
  });

  it("x-vercel-id がなければ UUID を reqId にする", async () => {
    await app.request("/health");

    expect(accessLogs()[0]?.reqId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it.each([
    ["GET", "/health", "/health", 200],
    ["POST", "/api/v1/embedding", "/api/v1/embedding", 400],
    ["POST", "/api/v1/summary/123", "/api/v1/summary/:id", 400],
    ["GET", "/nope", "/*", 404],
    ["GET", "/api/v1/nope", "/api/v1/*", 404],
  ] as const)("%s %s の route は %s になり、level は info のまま", async (method, path, route, status) => {
    const response = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });

    expect(response.status).toBe(status);
    expect(accessLogs()).toEqual([
      expect.objectContaining({ level: "info", method, route, path, status }),
    ]);
  });

  it("クエリ文字列・ヘッダー・本文は出さない", async () => {
    await app.request("/api/v1/embedding?q=QUERY_SECRET", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": KEY_FRAGMENT },
      body: JSON.stringify({ text: ABSTRACT }),
    });

    expect(accessLogs()).toHaveLength(1);
    expect(accessLogs()[0]?.path).toBe("/api/v1/embedding");
    expect(lines.join("")).not.toContain("SECRET");
  });

  it("(e) 未処理の例外は 500 の固定文言を返し、code=internal の error を1行出して本文やキーを出さない", async () => {
    const response = await app.request("/__throw", { headers: { "x-vercel-id": "req-throw" } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal Server Error" });
    const errorLines = parsed().filter((line) => line.msg !== "request");
    expect(errorLines).toEqual([
      expect.objectContaining({
        level: "error",
        code: "internal",
        reqId: "req-throw",
        msg: "unhandled error",
        err: expect.objectContaining({ name: "AI_APICallError", statusCode: 401 }),
      }),
    ]);
    expect(accessLogs()).toEqual([
      expect.objectContaining({ level: "info", reqId: "req-throw", status: 500 }),
    ]);
    expect(lines.join("")).not.toContain("SECRET");
  });
});
