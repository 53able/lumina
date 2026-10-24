import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_BATCH_MAX_SIZE, EMBEDDING_DIMENSION } from "../../shared/schemas/index";
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

import { ArxivRateLimitError, resetArxivGateForTest } from "../services/arxivFetcher";
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

  /** period: "7" の範囲内の論文を count 件含む arXiv フィード */
  const createMockArxivFeed = (count: number): string => {
    const isoDate = getRecentIsoDate();
    const entries = Array.from(
      { length: count },
      (_, i) => `
      <entry>
        <id>http://arxiv.org/abs/2401.${String(i).padStart(5, "0")}v1</id>
        <title>Paper ${i}</title>
        <summary>Abstract ${i}</summary>
        <author><name>Author</name></author>
        <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
        <published>${isoDate}</published>
        <updated>${isoDate}</updated>
      </entry>`
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">${count}</opensearch:totalResults>${entries}
    </feed>`;
  };

  /** sync のレートリミット（12 件/60 秒/IP）に掛からないよう、リクエストごとに IP を変える */
  let requestCount = 0;
  const syncRequest = (body: Record<string, unknown>, withApiKey = false) =>
    new Request("http://localhost/api/v1/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `198.51.100.${++requestCount}`,
        ...(withApiKey ? { "X-OpenAI-API-Key": openAIKeyHeader } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    // 前のテストの arXiv 送信予約が残っていると送信間隔の待ちが発生するため初期化する
    resetArxivGateForTest();

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

    it("正常系: skipEmbedding: true のときはAPIキーがあってもEmbeddingを生成しない", async () => {
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
          skipEmbedding: true,
        }),
      });

      const response = await app.request(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.fetchedCount).toBe(2);
      expect(body.papers[0].embedding).toBeUndefined();
      expect(createEmbeddingsBatch).not.toHaveBeenCalled();
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

    it("existingPaperIds が無いときは従来どおり全件 Embedding になる", async () => {
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
      const response = await app.request(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.papers).toHaveLength(2);
      expect(body.papers[0].embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(body.papers[1].embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createEmbeddingsBatch).mock.calls[0][0]).toHaveLength(2);
    });

    it("existingPaperIds に含まれる ID の論文は Embedding を生成せず、新規のみ createEmbeddingsBatch に渡す", async () => {
      // モックは 2 件: id は 2401.00001, 2401.00002（arxiv URL から抽出）
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
          existingPaperIds: ["2401.00001"],
        }),
      });
      const response = await app.request(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.papers).toHaveLength(2);
      const paper1 = body.papers.find((p: { id: string }) => p.id === "2401.00001");
      const paper2 = body.papers.find((p: { id: string }) => p.id === "2401.00002");
      expect(paper1.embedding).toBeUndefined();
      expect(paper2.embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createEmbeddingsBatch).mock.calls[0][0]).toHaveLength(1);
    });

    it("existingPaperIds が空配列のときは従来どおり全件 Embedding", async () => {
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
          existingPaperIds: [],
        }),
      });
      const response = await app.request(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.papers[0].embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(body.papers[1].embedding).toHaveLength(EMBEDDING_DIMENSION);
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createEmbeddingsBatch).mock.calls[0][0]).toHaveLength(2);
    });

    it("異常系: arXiv が 503 のときは 503 と Retry-After: 5 を返す", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      } as Response);

      const request = new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ["cs.AI"], period: "7", maxResults: 10 }),
      });
      const response = await app.request(request);

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(await response.json()).toEqual({
        error: "arXiv is temporarily unavailable.",
        code: "upstream",
        retryable: true,
      });
    });

    it("異常系: arXiv が 429 のときは上流の本文を返さず固定の文言と Retry-After を返す", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "7" }),
        text: () => Promise.resolve("<summary>upstream secret detail</summary>"),
      } as Response);

      const response = await app.request(syncRequest({ categories: ["cs.AI"], period: "7" }));

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("7");
      const text = await response.text();
      expect(text).not.toContain("upstream secret detail");
      expect(JSON.parse(text)).toEqual({
        error: "arXiv is busy. Please retry later.",
        code: "rate_limit",
        retryable: true,
      });
    });

    it("異常系: 想定外のエラーは例外の message を返さず 500 の固定文言を返す", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers(),
        text: () => Promise.resolve("<summary>internal detail</summary>"),
      } as Response);

      const response = await app.request(syncRequest({ categories: ["cs.AI"], period: "7" }));

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain("internal detail");
      expect(JSON.parse(text)).toEqual({
        error: "Sync failed.",
        code: "internal",
        retryable: false,
      });
    });

    it("異常系: arXiv 待ち行列の上限超過（ArxivRateLimitError）は待ち時間を本文に含めない", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(global.fetch).mockRejectedValue(
        new ArxivRateLimitError("arXiv request queue is full (estimated wait 18000ms)", 6)
      );

      const response = await app.request(syncRequest({ categories: ["cs.AI"], period: "7" }));

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("6");
      expect(await response.text()).not.toContain("18000");
    });

    it("リクエスト開始から 40 秒を超えたら残りのチャンクは Embedding を生成せずに返す", async () => {
      // 1 チャンク目の生成で 41 秒経過したことにする
      const startedAt = Date.now();
      let elapsedMs = 0;
      vi.spyOn(Date, "now").mockImplementation(() => startedAt + elapsedMs);
      vi.mocked(createEmbeddingsBatch).mockImplementation(async (texts: string[]) => {
        elapsedMs = 41_000;
        return {
          embeddings: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0.1)),
          tokensUsed: texts.length * 10,
        };
      });
      const paperCount = EMBEDDING_BATCH_MAX_SIZE + 5;
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(createMockArxivFeed(paperCount)),
      } as Response);

      const response = await app.request(
        syncRequest({ categories: ["cs.AI"], period: "7", maxResults: 50 }, true)
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.papers).toHaveLength(paperCount);
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(1);
      const withEmbedding = body.papers.filter((p: { embedding?: number[] }) => p.embedding);
      expect(withEmbedding).toHaveLength(EMBEDDING_BATCH_MAX_SIZE);
      expect(body.papers[EMBEDDING_BATCH_MAX_SIZE].embedding).toBeUndefined();
    });

    it("Embedding は締め切り付きの signal と再試行なしで生成し、途中のチャンクが失敗したら生成済みの分を残して返す", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(createEmbeddingsBatch)
        .mockImplementationOnce(async (texts: string[]) => ({
          embeddings: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0.1)),
          tokensUsed: texts.length * 10,
        }))
        .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
      const paperCount = EMBEDDING_BATCH_MAX_SIZE + 5;
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(createMockArxivFeed(paperCount)),
      } as Response);

      const response = await app.request(
        syncRequest({ categories: ["cs.AI"], period: "7", maxResults: 50 }, true)
      );

      expect(response.status).toBe(200);
      const options = vi.mocked(createEmbeddingsBatch).mock.calls[0][2];
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options?.maxRetries).toBe(0);
      const body = await response.json();
      expect(body.papers).toHaveLength(paperCount);
      const withEmbedding = body.papers.filter((p: { embedding?: number[] }) => p.embedding);
      expect(withEmbedding).toHaveLength(EMBEDDING_BATCH_MAX_SIZE);
    });

    it("40 秒以内なら全チャンクの Embedding を生成する", async () => {
      const paperCount = EMBEDDING_BATCH_MAX_SIZE + 5;
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(createMockArxivFeed(paperCount)),
      } as Response);

      const response = await app.request(
        syncRequest({ categories: ["cs.AI"], period: "7", maxResults: 50 }, true)
      );

      const body = await response.json();
      expect(createEmbeddingsBatch).toHaveBeenCalledTimes(2);
      expect(body.papers.every((p: { embedding?: number[] }) => p.embedding)).toBe(true);
    });
  });
});
