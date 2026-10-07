import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, embed, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { toStageError } from "./upstreamError";

const quotaBody = {
  error: {
    message: "You exceeded your current quota, please check your plan and billing details.",
    type: "insufficient_quota",
    param: null,
    code: "insufficient_quota",
  },
};

const apiCallError = (statusCode: number, body: unknown, withData = true) =>
  new APICallError({
    message: "upstream",
    url: "https://api.openai.com/v1/embeddings",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify(body),
    ...(withData && { data: body }),
  });

describe("toStageError", () => {
  it("429 + insufficient_quota（data）は quota（再試行不可）に分類する", () => {
    expect(toStageError(apiCallError(429, quotaBody))).toEqual({ code: "quota", retryable: false });
  });

  it("429 + insufficient_quota（responseBody のみ）も quota に分類する", () => {
    expect(toStageError(apiCallError(429, quotaBody, false))).toEqual({
      code: "quota",
      retryable: false,
    });
  });

  it("RetryError に包まれた 429 + insufficient_quota も quota に分類する", () => {
    const error = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiCallError(429, quotaBody)],
    });
    expect(toStageError(error)).toEqual({ code: "quota", retryable: false });
  });

  it("通常の 429（code が rate_limit_exceeded）は rate_limit のまま", () => {
    const body = { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } };
    expect(toStageError(apiCallError(429, body))).toEqual({ code: "rate_limit", retryable: true });
  });

  it("本文が JSON でない 429 は rate_limit のまま", () => {
    const error = new APICallError({
      message: "upstream",
      url: "https://api.openai.com/v1/embeddings",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: "Too Many Requests",
    });
    expect(toStageError(error)).toEqual({ code: "rate_limit", retryable: true });
  });

  it("429 以外のステータスでは code が insufficient_quota でも quota にしない", () => {
    expect(toStageError(apiCallError(500, quotaBody))).toEqual({
      code: "upstream",
      retryable: true,
    });
  });

  it("code が null で type が insufficient_quota の本文（互換プロバイダ）も quota に分類する", () => {
    const body = { error: { message: "quota", type: "insufficient_quota", code: null } };
    expect(toStageError(apiCallError(429, body))).toEqual({ code: "quota", retryable: false });
  });

  it("type が別の値で code もない 429 は rate_limit のまま", () => {
    const body = { error: { message: "slow down", type: "requests", code: null } };
    expect(toStageError(apiCallError(429, body))).toEqual({ code: "rate_limit", retryable: true });
  });

  // SDK 更新で APICallError の data / responseBody の形が変わった場合に検出する
  it("実際の SDK（createOpenAI + embed）が投げる 429 + insufficient_quota を quota に分類する", async () => {
    const fetch = async () =>
      new Response(JSON.stringify(quotaBody), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    const provider = createOpenAI({ apiKey: "test", fetch: fetch as typeof globalThis.fetch });

    const error = await embed({
      model: provider.embedding("text-embedding-3-small"),
      value: "text",
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(APICallError.isInstance(error)).toBe(true);
    expect(toStageError(error)).toEqual({ code: "quota", retryable: false });
  });
});
