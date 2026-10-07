import { APICallError, RetryError } from "ai";
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
});
