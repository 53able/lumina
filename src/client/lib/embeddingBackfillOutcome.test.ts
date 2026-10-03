import { describe, expect, it } from "vitest";
import { EmbeddingApiError, EmbeddingRateLimitError } from "./api";
import {
  classifyEmbeddingBackfillError,
  createEmbeddingBackfillOutcome,
  EmbeddingApiKeyMissingError,
} from "./embeddingBackfillOutcome";

describe("classifyEmbeddingBackfillError", () => {
  it.each([
    ["429", new EmbeddingRateLimitError(), "rate_limit", "しばらく待って"],
    ["401", new EmbeddingApiError("Incorrect API key", 401), "auth", "APIキー"],
    ["403", new EmbeddingApiError("forbidden", 403), "auth", "APIキー"],
    ["キー未設定", new EmbeddingApiKeyMissingError(), "auth", "APIキー"],
    ["キー復号失敗", new DOMException("decrypt failed", "OperationError"), "auth", "APIキー"],
    ["ネットワーク", new TypeError("Failed to fetch"), "network", "接続を確認"],
    ["500", new EmbeddingApiError("Internal Server Error", 500), "server", "時間をおいて"],
  ] as const)("%s は %s に分類され、対応する次の操作を案内する", (_label, error, kind, guidance) => {
    const failure = classifyEmbeddingBackfillError(error);
    expect(failure.kind).toBe(kind);
    expect(failure.guidance).toContain(guidance);
  });

  it("500 の理由にはステータスを含め、詳細にサーバーのメッセージを残す", () => {
    const failure = classifyEmbeddingBackfillError(new EmbeddingApiError("upstream down", 500));
    expect(failure.reason).toContain("500");
    expect(failure.detail).toBe("upstream down");
  });
  it("認証エラーの詳細（APIキーの一部を含みうる）は残さない", () => {
    const failure = classifyEmbeddingBackfillError(
      new EmbeddingApiError("Incorrect API key provided: sk-ab***xyz", 401)
    );
    expect(failure.detail).toBeUndefined();
  });
});

describe("createEmbeddingBackfillOutcome", () => {
  it("エラーなしで全件完了したら success", () => {
    expect(createEmbeddingBackfillOutcome(3, 3, null)).toEqual({
      status: "success",
      completed: 3,
      total: 3,
      failure: null,
    });
  });

  it("一部完了後にエラーなら partial（完了件数を保持）", () => {
    const outcome = createEmbeddingBackfillOutcome(1, 3, new EmbeddingApiError("boom", 500));
    expect(outcome.status).toBe("partial");
    expect(outcome.completed).toBe(1);
    expect(outcome.failure?.kind).toBe("server");
  });

  it("1件も完了せずエラーなら failed", () => {
    const outcome = createEmbeddingBackfillOutcome(0, 3, new TypeError("Failed to fetch"));
    expect(outcome.status).toBe("failed");
    expect(outcome.failure?.kind).toBe("network");
  });

  it("エラーなしでも未完了が残れば success にしない", () => {
    const outcome = createEmbeddingBackfillOutcome(2, 3, null);
    expect(outcome.status).toBe("partial");
    expect(outcome.failure).not.toBeNull();
  });
});
