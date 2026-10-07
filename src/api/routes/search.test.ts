import { APICallError, RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import { createApp } from "../app";

// OpenAIサービスをモック
vi.mock("../services/openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openai")>();
  return {
    ...original,
    createEmbedding: vi.fn(),
    expandQuery: vi.fn(),
  };
});

import { createEmbedding, expandQuery } from "../services/openai";

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
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: JSON.stringify(data),
    data,
  });
};

describe("検索API", () => {
  const app = createApp();
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
    describe("失敗（上流のエラー文を返さない）", () => {
      const upstreamMessage = "Incorrect API key provided: sk-proj-abcd...wxyz";

      const postSearch = () =>
        app.request(
          new Request("http://localhost/api/v1/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-OpenAI-API-Key": openAIKeyHeader },
            body: JSON.stringify({ query: "深層学習" }),
          })
        );

      it.each([
        [401, 401, "auth", false],
        [403, 401, "auth", false],
        [429, 429, "rate_limit", true],
        [500, 500, "upstream", true],
      ] as const)("異常系: クエリ拡張が上流 %s で失敗した場合は %s・安全な分類だけを返す", async (upstreamStatus, status, code, retryable) => {
        vi.mocked(expandQuery).mockRejectedValueOnce(
          Object.assign(new Error(upstreamMessage), { statusCode: upstreamStatus })
        );

        const response = await postSearch();

        expect(response.status).toBe(status);
        const body = await response.json();
        expect(body).toEqual({ error: "検索に失敗しました", code, retryable });
        expect(JSON.stringify(body)).not.toContain("sk-");
        expect(JSON.stringify(body)).not.toContain("Incorrect API key");
      });

      it("異常系: 429 + insufficient_quota は quota として402で返し、上流の文言を返さない", async () => {
        vi.mocked(expandQuery).mockRejectedValueOnce(quotaError());

        const response = await postSearch();

        expect(response.status).toBe(402);
        const body = await response.json();
        expect(body).toEqual({ error: "検索に失敗しました", code: "quota", retryable: false });
        expect(JSON.stringify(body)).not.toContain("exceeded your current quota");
      });

      it("異常系: Embedding 生成の RetryError に包まれた429も rate_limit として429で返す", async () => {
        vi.mocked(createEmbedding).mockRejectedValueOnce(
          new RetryError({
            message: `Failed after 3 attempts. Last error: ${upstreamMessage}`,
            reason: "maxRetriesExceeded",
            errors: [Object.assign(new Error(upstreamMessage), { statusCode: 429 })],
          })
        );

        const response = await postSearch();

        expect(response.status).toBe(429);
        const body = await response.json();
        expect(body).toEqual({ error: "検索に失敗しました", code: "rate_limit", retryable: true });
      });
    });

    it("正常系: APIキーなしでスタブ結果を返す", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
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

    describe("embeddingText（確認・編集した検索文での再検索 #31）", () => {
      const postSearch = (body: Record<string, unknown>, withKey = true) =>
        app.request(
          new Request("http://localhost/api/v1/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(withKey ? { "X-OpenAI-API-Key": openAIKeyHeader } : {}),
            },
            body: JSON.stringify(body),
          })
        );

      it("指定した検索文をそのまま Embedding に渡し、クエリ拡張を呼ばない", async () => {
        const response = await postSearch({
          query: "深層学習",
          embeddingText: "deep learning text classification",
        });

        expect(response.status).toBe(200);
        expect(expandQuery).not.toHaveBeenCalled();
        expect(createEmbedding).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createEmbedding).mock.calls[0]?.[0]).toBe(
          "deep learning text classification"
        );
        const body = await response.json();
        expect(body.expandedQuery).toEqual({
          original: "深層学習",
          english: "深層学習",
          synonyms: [],
          searchText: "deep learning text classification",
        });
        expect(body.queryEmbedding).toHaveLength(EMBEDDING_DIMENSION);
      });

      it("前後の空白は除いて Embedding に渡す", async () => {
        await postSearch({ query: "深層学習", embeddingText: "  deep learning  " });

        expect(vi.mocked(createEmbedding).mock.calls[0]?.[0]).toBe("deep learning");
      });

      it("未指定ならクエリ拡張の searchText を Embedding に渡す", async () => {
        await postSearch({ query: "深層学習" });

        expect(expandQuery).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createEmbedding).mock.calls[0]?.[0]).toBe("deep learning neural network");
      });

      it("APIキーなしではスタブにせずエラーを返す（Embedding できなかったことを隠さない）", async () => {
        const response = await postSearch(
          { query: "深層学習", embeddingText: "deep learning" },
          false
        );

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body).toEqual({ error: "検索に失敗しました", code: "auth", retryable: false });
        expect(body).not.toHaveProperty("expandedQuery");
        expect(createEmbedding).not.toHaveBeenCalled();
      });

      it("異常系: 空白のみの検索文は400エラー", async () => {
        const response = await postSearch({ query: "深層学習", embeddingText: "   " });

        expect(response.status).toBe(400);
        expect(createEmbedding).not.toHaveBeenCalled();
      });

      it("異常系: 8,000文字を超える検索文は400エラー", async () => {
        const response = await postSearch({ query: "深層学習", embeddingText: "a".repeat(8001) });

        expect(response.status).toBe(400);
        expect(createEmbedding).not.toHaveBeenCalled();
      });

      it("8,000文字ちょうどの検索文は受け付ける", async () => {
        const response = await postSearch({ query: "深層学習", embeddingText: "a".repeat(8000) });

        expect(response.status).toBe(200);
      });
    });

    it("異常系: 空のクエリの場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/search", {
        method: "POST",
        headers: {
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
  });
});
