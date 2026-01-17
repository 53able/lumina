/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSemanticSearch } from "./useSemanticSearch";

// グローバルfetchのモック
const mockFetch = vi.fn();
global.fetch = mockFetch;

// モックのEmbeddingデータ（1536次元を簡略化）
const createMockEmbedding = (seed: number): number[] => {
  const embedding: number[] = [];
  for (let i = 0; i < 10; i++) {
    embedding.push(Math.sin(seed + i) * 0.5);
  }
  return embedding;
};

// モック論文データ
const mockPapers = [
  {
    id: "2401.00001",
    title: "Attention Is All You Need",
    abstract: "The dominant sequence transduction models...",
    authors: ["Ashish Vaswani"],
    categories: ["cs.CL", "cs.LG"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding: createMockEmbedding(1), // 類似度高め
  },
  {
    id: "2401.00002",
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    abstract: "We introduce a new language representation model...",
    authors: ["Jacob Devlin"],
    categories: ["cs.CL"],
    publishedAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00002.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00002",
    embedding: createMockEmbedding(2), // 類似度中
  },
  {
    id: "2401.00003",
    title: "Unrelated Paper About Cooking",
    abstract: "This paper discusses cooking methods...",
    authors: ["Chef Gordon"],
    categories: ["misc"],
    publishedAt: new Date("2024-01-03"),
    updatedAt: new Date("2024-01-03"),
    pdfUrl: "https://arxiv.org/pdf/2401.00003.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00003",
    embedding: createMockEmbedding(100), // 類似度低め
  },
];

// APIレスポンスのモック
const mockSearchResponse = {
  results: [],
  expandedQuery: {
    original: "transformer",
    english: "transformer",
    synonyms: ["attention mechanism", "self-attention"],
    searchText: "transformer attention mechanism self-attention",
  },
  queryEmbedding: createMockEmbedding(1), // 最初の論文と類似
  took: 150,
};

describe("useSemanticSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("初期状態", () => {
    it("初期状態ではローディングでなく、結果が空である", () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.expandedQuery).toBeNull();
    });
  });

  describe("検索実行", () => {
    it("search関数を呼ぶと検索APIが呼ばれる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ query: "transformer", limit: 20 }),
        })
      );
    });

    it("検索中はisLoadingがtrueになる", async () => {
      // レスポンスを遅延させる
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve(mockSearchResponse),
                }),
              100
            )
          )
      );

      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      act(() => {
        result.current.search("transformer");
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it("検索結果は類似度順にソートされる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.results.length).toBeGreaterThan(0);

      // 類似度が高い順にソートされていることを確認
      for (let i = 1; i < result.current.results.length; i++) {
        const prev = result.current.results[i - 1];
        const curr = result.current.results[i];
        expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      }
    });

    it("検索結果にはpaper情報とスコアが含まれる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.results[0]).toHaveProperty("paper");
      expect(result.current.results[0]).toHaveProperty("score");
      expect(result.current.results[0].paper).toHaveProperty("id");
      expect(result.current.results[0].paper).toHaveProperty("title");
    });

    it("拡張クエリが取得できる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.expandedQuery).toEqual(mockSearchResponse.expandedQuery);
    });
  });

  describe("エラーハンドリング", () => {
    it("APIエラー時にerrorが設定される", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal Server Error" }),
      });

      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.results).toEqual([]);
    });

    it("ネットワークエラー時にerrorが設定される", async () => {
      mockFetch.mockRejectedValue(new Error("Network Error"));

      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe("オプション", () => {
    it("limitオプションでAPIに渡す件数を変更できる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers, limit: 50 }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/search",
        expect.objectContaining({
          body: JSON.stringify({ query: "transformer", limit: 50 }),
        })
      );
    });

    it("embeddingがない論文は検索結果から除外される", async () => {
      const papersWithoutEmbedding = [
        ...mockPapers,
        {
          id: "2401.00004",
          title: "Paper Without Embedding",
          abstract: "No embedding here...",
          authors: ["Someone"],
          categories: ["cs.AI"],
          publishedAt: new Date("2024-01-04"),
          updatedAt: new Date("2024-01-04"),
          pdfUrl: "https://arxiv.org/pdf/2401.00004.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00004",
          // embeddingなし
        },
      ];

      const { result } = renderHook(() => useSemanticSearch({ papers: papersWithoutEmbedding }));

      await act(async () => {
        await result.current.search("transformer");
      });

      // embeddingのない論文は結果に含まれない
      const resultIds = result.current.results.map((r) => r.paper.id);
      expect(resultIds).not.toContain("2401.00004");
    });
  });

  describe("reset機能", () => {
    it("reset関数で状態をクリアできる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.results.length).toBeGreaterThan(0);

      act(() => {
        result.current.reset();
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.expandedQuery).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
