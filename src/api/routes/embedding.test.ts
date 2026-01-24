import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import { createApp } from "../app";

// OpenAIサービスをモック
vi.mock("../services/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openai")>();
  return {
    ...original,
    createEmbedding: vi.fn(),
  };
});

import { createEmbedding } from "../services/openai";

describe("Embedding API", () => {
  const app = createApp();
  const authHeader = `Basic ${Buffer.from("admin:admin").toString("base64")}`;
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();

    // createEmbeddingのモック
    vi.mocked(createEmbedding).mockResolvedValue({
      embedding: Array(EMBEDDING_DIMENSION).fill(0.1),
      tokensUsed: 10,
    });
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
          Authorization: authHeader,
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
          Authorization: authHeader,
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
          Authorization: authHeader,
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
          Authorization: authHeader,
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
          Authorization: authHeader,
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

    it("異常系: APIキーがない場合は500エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          Authorization: authHeader,
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
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain("API key");
    });

    it("異常系: 認証なしの場合は401エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/embedding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          text: "test",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(401);
    });
  });
});
