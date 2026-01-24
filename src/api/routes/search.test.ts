import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index.js";
import { createApp } from "../app.js";

// OpenAIサービスをモック
vi.mock("../services/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openai")>();
  return {
    ...original,
    createEmbedding: vi.fn(),
    expandQuery: vi.fn(),
  };
});

import { createEmbedding, expandQuery } from "../services/openai.js";

describe("検索API", () => {
  const app = createApp();
  const authHeader = `Basic ${Buffer.from("admin:admin").toString("base64")}`;
  const openAIKeyHeader = "test-openai-api-key";

  beforeEach(() => {
    vi.clearAllMocks();

    // expandQueryのモック
    vi.mocked(expandQuery).mockResolvedValue({
      original: "深層学習",
      english: "deep learning",
      synonyms: ["neural network", "machine learning"],
      searchText: "deep learning neural network",
    });

    // createEmbeddingのモック
    vi.mocked(createEmbedding).mockResolvedValue({
      embedding: Array(EMBEDDING_DIMENSION).fill(0.1),
      tokensUsed: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/search", () => {
    it("正常系: APIキーなしでスタブ結果を返す", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          // X-OpenAI-API-Key を省略
        },
        body: JSON.stringify({
          query: "強化学習の最新研究",
          limit: 10,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("expandedQuery");
      expect(body).toHaveProperty("took");
      expect(Array.isArray(body.results)).toBe(true);
      // OpenAIサービスは呼ばれない
      expect(expandQuery).not.toHaveBeenCalled();
      expect(createEmbedding).not.toHaveBeenCalled();
    });

    it("正常系: APIキーありでOpenAI APIを使用して検索準備", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          query: "深層学習",
          limit: 10,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.expandedQuery.english).toBe("deep learning");
      expect(body).toHaveProperty("queryEmbedding");
      expect(body.queryEmbedding).toHaveLength(EMBEDDING_DIMENSION);
      // OpenAIサービスが呼ばれる
      expect(expandQuery).toHaveBeenCalledTimes(1);
      expect(createEmbedding).toHaveBeenCalledTimes(1);
    });

    it("正常系: 英語クエリで検索できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "reinforcement learning",
          limit: 20,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
    });

    it("正常系: カテゴリフィルタを指定できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "machine learning",
          limit: 10,
          categories: ["cs.AI", "cs.LG"],
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
    });

    it("正常系: expandedQueryに拡張結果が含まれる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "深層学習",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      const body = await response.json();
      expect(body.expandedQuery).toHaveProperty("original");
      expect(body.expandedQuery).toHaveProperty("english");
      expect(body.expandedQuery).toHaveProperty("synonyms");
      expect(body.expandedQuery).toHaveProperty("searchText");
    });

    it("異常系: 空のクエリの場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    it("異常系: limitが範囲外の場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "test",
          limit: 1000,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    it("異常系: 認証なしの場合は401エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "test",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(401);
    });
  });
});
