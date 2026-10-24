import { APICallError, RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import { createApp } from "../app";
import { createLogger } from "../lib/logger";

// OpenAIサービスをモック
vi.mock("../services/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openai")>();
  return {
    ...original,
    createEmbedding: vi.fn(),
    createEmbeddingsBatch: vi.fn(),
  };
});

import { createEmbedding, createEmbeddingsBatch } from "../services/openai";

/** OpenAI が残高不足で返す 429（本文の code が insufficient_quota） */
const quotaError = () => {
  const data = {
    error: {
      message: "You exceeded your current quota",
      type: "insufficient_quota",
      code: "insufficient_quota",
    },
  };
  return new APICallError({
    message: data.error.message,
    url: "https://api.openai.com/v1/embeddings",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify(data),
    data,
  });
};

describe("Embedding API", () => {
  /** ルートが出したログ（メモリの sink に書かせて JSON で読む） */
  const logLines: Record<string, unknown>[] = [];
  const app = createApp({
    logger: createLogger({
      level: "trace",
      sink: { write: (line) => logLines.push(JSON.parse(line)) },
    }),
  });
  /** アクセスログ以外の行 */
  const routeLogs = () => logLines.filter((line) => line.msg !== "request");
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
    logLines.length = 0;

    // createEmbeddingのモック
    vi.mocked(createEmbedding).mockResolvedValue({
      embedding: Array(EMBEDDING_DIMENSION).fill(0.1),
      tokensUsed: 10,
    });

    // createEmbeddingsBatch のモック
    vi.mocked(createEmbeddingsBatch).mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0.1)),
      tokensUsed: texts.length * 10,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/embedding", () => {
    it("正常系: テキストからEmbeddingを生成できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          text: "強化学習に関する最新の研究",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("embedding");
      expect(body).toHaveProperty("model");
      expect(body).toHaveProperty("took");
      expect(Array.isArray(body.embedding)).toBe(true);
      expect(body.embedding.length).toBe(EMBEDDING_DIMENSION);
    });

    it("正常系: 英語テキストでもEmbeddingを生成できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          text: "Recent advances in reinforcement learning",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
    });

    it("正常系: createEmbeddingが正しいパラメータで呼ばれる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          text: "test text",
        }),
      });

      // Act
      await app.request(request);

      // Assert
      expect(createEmbedding).toHaveBeenCalledWith(
        "test text",
        expect.objectContaining({ apiKey: openAIKeyHeader })
      );
    });

    it("異常系: 空のテキストの場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          text: "",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    it("異常系: テキストがない場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({}),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    it("異常系: APIキーがない場合は401エラー（設定の問題として区別する）", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // X-OpenAI-API-Key を省略
        },
        body: JSON.stringify({
          text: "test",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({
        error: "Embeddingの生成に失敗しました",
        code: "auth",
        retryable: false,
      });
    });

    it.each([
      [401, 401, "auth", false],
      [403, 401, "auth", false],
      [429, 429, "rate_limit", true],
      [502, 500, "upstream", true],
    ] as const)("異常系: OpenAI が %i を返したときは %i・安全な分類だけを返す", async (upstreamStatus, expectedStatus, code, retryable) => {
      vi.mocked(createEmbedding).mockRejectedValueOnce(
        Object.assign(new Error("Incorrect API key provided: sk-proj-abcd...wxyz"), {
          statusCode: upstreamStatus,
        })
      );
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
        body: JSON.stringify({ text: "test" }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(expectedStatus);
      const body = await response.json();
      expect(body).toEqual({ error: "Embeddingの生成に失敗しました", code, retryable });
      expect(JSON.stringify(body)).not.toContain("sk-");
      expect(JSON.stringify(body)).not.toContain("Incorrect API key");
    });
  });

  describe("POST /api/v1/embedding/batch", () => {
    it("異常系: 再試行上限に達した 429（RetryError）は429として返す", async () => {
      const rateLimited = Object.assign(new Error("Rate limit reached"), { statusCode: 429 });
      vi.mocked(createEmbeddingsBatch).mockRejectedValueOnce(
        new RetryError({
          message: "Failed after 3 attempts",
          reason: "maxRetriesExceeded",
          errors: [rateLimited, rateLimited, rateLimited],
        })
      );
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
        body: JSON.stringify({ texts: ["a"] }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body).toEqual({
        error: "Embeddingの生成に失敗しました",
        code: "rate_limit",
        retryable: true,
      });
    });

    it("異常系: 429 + insufficient_quota は quota として402で返し、上流の文言を返さない", async () => {
      vi.mocked(createEmbeddingsBatch).mockRejectedValueOnce(
        new RetryError({
          message: "Failed after 3 attempts",
          reason: "maxRetriesExceeded",
          errors: [quotaError()],
        })
      );
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
        body: JSON.stringify({ texts: ["a"] }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body).toEqual({
        error: "Embeddingの生成に失敗しました",
        code: "quota",
        retryable: false,
      });
      expect(JSON.stringify(body)).not.toContain("exceeded your current quota");
    });

    it("異常系: OpenAI の認証エラーは401として返す", async () => {
      vi.mocked(createEmbeddingsBatch).mockRejectedValueOnce(
        Object.assign(new Error("Incorrect API key provided"), { statusCode: 401 })
      );
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
        body: JSON.stringify({ texts: ["a", "b"] }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({
        error: "Embeddingの生成に失敗しました",
        code: "auth",
        retryable: false,
      });
      expect(JSON.stringify(body)).not.toContain("Incorrect API key");
    });

    it("正常系: 複数テキストからEmbeddingを一括生成できる", async () => {
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          texts: ["text one", "text two"],
        }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("embeddings");
      expect(body).toHaveProperty("model");
      expect(body).toHaveProperty("took");
      expect(Array.isArray(body.embeddings)).toBe(true);
      expect(body.embeddings).toHaveLength(2);
      expect(body.embeddings[0]).toHaveLength(EMBEDDING_DIMENSION);
      expect(body.embeddings[1]).toHaveLength(EMBEDDING_DIMENSION);
    });

    it("正常系: createEmbeddingsBatch が正しいパラメータで呼ばれる", async () => {
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          texts: ["a", "b", "c"],
        }),
      });

      await app.request(request);

      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      expect(createEmbeddingsBatch).toHaveBeenCalledWith(
        ["a", "b", "c"],
        expect.objectContaining({ apiKey: openAIKeyHeader })
      );
    });

    it("異常系: texts が空の場合は400エラー", async () => {
      const request = new Request("http://localhost/api/v1/embedding/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({ texts: [] }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(400);
    });
  });

  describe("ログ", () => {
    const postEmbedding = (withApiKey = true) =>
      app.request(
        new Request("http://localhost/api/v1/embedding", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(withApiKey ? { "X-OpenAI-API-Key": openAIKeyHeader } : {}),
          },
          body: JSON.stringify({ text: "test" }),
        })
      );

    it.each([
      [401, "auth", "warn"],
      [429, "rate_limit", "warn"],
      [502, "upstream", "error"],
    ] as const)("上流 %i の失敗は code=%s の行を %s で1行だけ出し、上流のエラー文は出さない", async (upstreamStatus, code, level) => {
      vi.mocked(createEmbedding).mockRejectedValueOnce(
        Object.assign(new Error("Incorrect API key provided: sk-proj-abcd...wxyz"), {
          statusCode: upstreamStatus,
        })
      );

      await postEmbedding();

      expect(routeLogs()).toEqual([
        expect.objectContaining({ level, code, msg: "embedding failed" }),
      ]);
      expect(JSON.stringify(logLines)).not.toContain("sk-");
    });

    it("本物の APICallError を RetryError で包んで投げても、本文とキー断片をログに出さない", async () => {
      const lastError = new APICallError({
        message: "Incorrect API key provided: sk-test-SECRETabcd",
        url: "https://api.openai.com/v1/embeddings",
        requestBodyValues: { input: "ABSTRACT_SECRET" },
        statusCode: 401,
        responseBody: JSON.stringify({
          error: { message: "key sk-test-SECRETabcd", input: "ABSTRACT_SECRET" },
        }),
        isRetryable: false,
        data: { error: { code: "invalid_api_key", type: "invalid_request_error" } },
      });
      vi.mocked(createEmbedding).mockRejectedValueOnce(
        new RetryError({
          message: `Failed after 3 attempts. Last error: ${lastError.message}`,
          reason: "maxRetriesExceeded",
          errors: [lastError, lastError, lastError],
        })
      );

      const response = await postEmbedding();

      expect(response.status).toBe(401);
      expect(routeLogs()).toEqual([
        expect.objectContaining({
          level: "warn",
          code: "auth",
          msg: "embedding failed",
          err: expect.objectContaining({
            name: "AI_RetryError",
            lastError: expect.objectContaining({ statusCode: 401, errorCode: "invalid_api_key" }),
          }),
        }),
      ]);
      expect(JSON.stringify(logLines)).not.toContain("SECRET");
    });

    it("一括生成の残高不足は code=quota の行を warn で1行だけ出す", async () => {
      vi.mocked(createEmbeddingsBatch).mockRejectedValueOnce(quotaError());

      await app.request(
        new Request("http://localhost/api/v1/embedding/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
          body: JSON.stringify({ texts: ["a"] }),
        })
      );

      expect(routeLogs()).toEqual([
        expect.objectContaining({ level: "warn", code: "quota", msg: "embedding batch failed" }),
      ]);
    });

    it("キー未設定は code=auth の行を debug で1行だけ出す", async () => {
      await postEmbedding(false);

      expect(routeLogs()).toEqual([
        expect.objectContaining({ level: "debug", code: "auth", msg: "embedding failed" }),
      ]);
    });
  });
});
