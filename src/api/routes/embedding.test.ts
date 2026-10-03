import { RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import { createApp } from "../app";

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

describe("Embedding API", () => {
  const app = createApp();
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();

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
      expect(body.error).toContain("API key");
    });

    it.each([
      [401, 401],
      [403, 403],
      [429, 429],
      [502, 500],
    ])("異常系: OpenAI が %i を返したときは %i を返す", async (upstreamStatus, expectedStatus) => {
      vi.mocked(createEmbedding).mockRejectedValueOnce(
        Object.assign(new Error("upstream error"), { statusCode: upstreamStatus })
      );
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
        body: JSON.stringify({ text: "test" }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(expectedStatus);
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
      expect(body.error).toContain("Incorrect API key");
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
});
