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

import { createEmbeddingsBatch } from "../services/openai";

describe("同期API", () => {
  const app = createApp();
  const openAIKeyHeader = "test-openai-api-key";

  /** period: "7" の範囲内になるよう、3日前の日付を生成する */
  const getRecentIsoDate = (): string => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  };

  const createMockArxivResponse = (): string => {
    const isoDate = getRecentIsoDate();
    return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:totalResults>
      <entry>
        <id>http://arxiv.org/abs/2401.00001v1</id>
        <title>Paper 1</title>
        <summary>Abstract for paper 1</summary>
        <author><name>Author 1</name></author>
        <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
        <published>${isoDate}</published>
        <updated>${isoDate}</updated>
        <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
        <link href="http://arxiv.org/pdf/2401.00001v1.pdf" title="pdf" rel="related" type="application/pdf"/>
      </entry>
      <entry>
        <id>http://arxiv.org/abs/2401.00002v1</id>
        <title>Paper 2</title>
        <summary>Abstract for paper 2</summary>
        <author><name>Author 2</name></author>
        <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
        <published>${isoDate}</published>
        <updated>${isoDate}</updated>
        <link href="http://arxiv.org/abs/2401.00002v1" rel="alternate" type="text/html"/>
        <link href="http://arxiv.org/pdf/2401.00002v1.pdf" title="pdf" rel="related" type="application/pdf"/>
      </entry>
    </feed>
  `;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // arXiv API呼び出しをモック（period 内の日付でレスポンスを返す）
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("arxiv.org")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(createMockArxivResponse()),
        } as Response);
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });

    // createEmbeddingsBatch のモック（sync はバッチで呼ぶ）
    vi.mocked(createEmbeddingsBatch).mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0.1)),
      tokensUsed: texts.length * 10,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/sync", () => {
    it("正常系: arXivから論文データを取得できる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categories: ["cs.AI"],
          period: "7",
          maxResults: 10,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("papers");
      expect(body).toHaveProperty("fetchedCount");
      expect(body).toHaveProperty("took");
      expect(Array.isArray(body.papers)).toBe(true);
      expect(body.fetchedCount).toBe(2);
    });

    it("正常系: APIキーありでEmbedding付き論文データを返す", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-API-Key": openAIKeyHeader,
        },
        body: JSON.stringify({
          categories: ["cs.AI"],
          period: "7",
          maxResults: 10,
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.papers[0]).toHaveProperty("embedding");
      expect(body.papers[0].embedding).toHaveLength(EMBEDDING_DIMENSION);
      // createEmbeddingsBatch が 1 回呼ばれ、2 件分のテキストが渡される
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createEmbeddingsBatch).mock.calls[0][0]).toHaveLength(2);
    });

    it("正常系: 複数カテゴリでの同期", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categories: ["cs.AI", "cs.LG", "stat.ML"],
          period: "7",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(200);
    });

    it("正常系: 論文データにはid, title, abstract, authorsが含まれる", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categories: ["cs.AI"],
          period: "7",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      const body = await response.json();
      const paper = body.papers[0];
      expect(paper).toHaveProperty("id");
      expect(paper).toHaveProperty("title");
      expect(paper).toHaveProperty("abstract");
      expect(paper).toHaveProperty("authors");
      expect(paper).toHaveProperty("categories");
    });

    it("異常系: カテゴリが空の場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categories: [],
          period: "7",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });

    it("異常系: 無効な期間の場合は400エラー", async () => {
      // Arrange
      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categories: ["cs.AI"],
          period: "999",
        }),
      });

      // Act
      const response = await app.request(request);

      // Assert
      expect(response.status).toBe(400);
    });
  });
});
