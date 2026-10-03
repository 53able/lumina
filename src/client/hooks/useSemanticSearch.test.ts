/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
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
    publishedAt: parseISO("2024-01-01"),
    updatedAt: parseISO("2024-01-01"),
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
    publishedAt: parseISO("2024-01-02"),
    updatedAt: parseISO("2024-01-02"),
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
    publishedAt: parseISO("2024-01-03"),
    updatedAt: parseISO("2024-01-03"),
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
      expect(result.current.queryEmbedding).toBeNull();
    });
  });

  describe("検索実行", () => {
    it("search関数を呼ぶと検索APIが呼ばれる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      // Hono RPCクライアントはフルURLで呼び出す
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: "transformer", limit: 20 }),
        })
      );
    });

    it("編集した拡張クエリを渡すと searchText を embeddingText として送り、表示用の英訳・関連語は保持する（#31）", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockSearchResponse,
            expandedQuery: {
              original: "transformer",
              english: "transformer",
              synonyms: [],
              searchText: "transformer attention mechanism",
            },
          }),
      });
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer", {
          ...mockSearchResponse.expandedQuery,
          searchText: "transformer attention mechanism",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/search",
        expect.objectContaining({
          body: JSON.stringify({
            query: "transformer",
            limit: 20,
            embeddingText: "transformer attention mechanism",
          }),
        })
      );
      expect(result.current.expandedQuery).toEqual({
        ...mockSearchResponse.expandedQuery,
        searchText: "transformer attention mechanism",
      });
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
        if (prev && curr) {
          expect(prev.score).toBeGreaterThanOrEqual(curr.score);
        }
      }
    });

    it("検索結果にはpaper情報とスコアが含まれる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.results[0]).toHaveProperty("paper");
      expect(result.current.results[0]).toHaveProperty("score");
      expect(result.current.results[0]?.paper).toHaveProperty("id");
      expect(result.current.results[0]?.paper).toHaveProperty("title");
    });

    it("拡張クエリが取得できる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.expandedQuery).toEqual(mockSearchResponse.expandedQuery);
    });

    it("queryEmbeddingが取得できる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.queryEmbedding).toEqual(mockSearchResponse.queryEmbedding);
    });
  });

  describe("保存済みデータでの検索", () => {
    it("searchWithSavedDataでAPIリクエストなしで検索できる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          mockSearchResponse.queryEmbedding
        );
      });

      // fetchが呼ばれていないことを確認
      expect(mockFetch).not.toHaveBeenCalled();

      // 検索結果が取得できていることを確認
      expect(result.current.results.length).toBeGreaterThan(0);
      expect(result.current.expandedQuery).toEqual(mockSearchResponse.expandedQuery);
      expect(result.current.queryEmbedding).toEqual(mockSearchResponse.queryEmbedding);
    });

    it("searchWithSavedDataで空のqueryEmbeddingの場合は結果が空になる", async () => {
      const { result } = renderHook(() => useSemanticSearch({ papers: mockPapers }));

      await act(async () => {
        await result.current.searchWithSavedData(mockSearchResponse.expandedQuery, []);
      });

      expect(result.current.results).toEqual([]);
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

      // Hono RPCクライアントはフルURLで呼び出す
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/search",
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
          publishedAt: parseISO("2024-01-04"),
          updatedAt: parseISO("2024-01-04"),
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

    it("検索実行後、embeddingが無い論文はpapersExcludedFromSearchに含まれる（常時可視化用）", async () => {
      const papersWithOneExcluded = [
        ...mockPapers,
        {
          id: "2401.00004",
          title: "Paper Without Embedding",
          abstract: "No embedding here...",
          authors: ["Someone"],
          categories: ["cs.AI"],
          publishedAt: parseISO("2024-01-04"),
          updatedAt: parseISO("2024-01-04"),
          pdfUrl: "https://arxiv.org/pdf/2401.00004.pdf",
          arxivUrl: "https://arxiv.org/abs/2401.00004",
        },
      ];

      const { result } = renderHook(() => useSemanticSearch({ papers: papersWithOneExcluded }));

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.papersExcludedFromSearch).toBeDefined();
      const excludedIds = result.current.papersExcludedFromSearch.map((p) => p.id);
      expect(excludedIds).toContain("2401.00004");
      expect(result.current.papersExcludedFromSearch).toHaveLength(1);
    });
  });

  describe("論文更新への追従（#45）", () => {
    /** Embedding未設定の論文（補完されるとクエリと高い類似度になる） */
    const paperPendingEmbedding = {
      id: "2401.00004",
      title: "Paper Pending Embedding",
      abstract: "Embedding will be backfilled...",
      authors: ["Someone"],
      categories: ["cs.AI"],
      publishedAt: parseISO("2024-01-04"),
      updatedAt: parseISO("2024-01-04"),
      pdfUrl: "https://arxiv.org/pdf/2401.00004.pdf",
      arxivUrl: "https://arxiv.org/abs/2401.00004",
    };

    const renderWithPapers = (initialPapers: Paper[]) =>
      renderHook(({ papers }: { papers: Paper[] }) => useSemanticSearch({ papers }), {
        initialProps: { papers: initialPapers },
      });

    it("検索表示中にEmbeddingを補完すると、検索対象外から外れてスコアに応じて結果に入る", async () => {
      const { result, rerender } = renderWithPapers([...mockPapers, paperPendingEmbedding]);

      await act(async () => {
        await result.current.search("transformer");
      });
      expect(result.current.papersExcludedFromSearch.map((p) => p.id)).toEqual(["2401.00004"]);
      expect(result.current.results.map((r) => r.paper.id)).not.toContain("2401.00004");
      const totalBefore = result.current.totalMatchCount;

      rerender({
        papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
      });

      expect(result.current.papersExcludedFromSearch).toEqual([]);
      const backfilled = result.current.results.find((r) => r.paper.id === "2401.00004");
      expect(backfilled?.score).toBeCloseTo(1);
      expect(backfilled?.paper.embedding).toEqual(createMockEmbedding(1));
      expect(result.current.totalMatchCount).toBe(totalBefore + 1);
      // 再計算に検索APIは使わない
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("検索表示中に論文が追加されると、閾値以上の論文だけが結果に入る", async () => {
      // 追加後の論文数（5件）が limit を下回るようにし、limit による切り捨ての影響を除く
      const limit = 10;
      const { result, rerender } = renderHook(
        ({ papers }: { papers: Paper[] }) => useSemanticSearch({ papers, limit }),
        { initialProps: { papers: mockPapers as Paper[] } }
      );

      await act(async () => {
        await result.current.search("transformer");
      });
      const idsBefore = result.current.results.map((r) => r.paper.id);

      const similarPaper = {
        ...paperPendingEmbedding,
        id: "2401.00005",
        embedding: createMockEmbedding(1),
      };
      const dissimilarPaper = {
        ...paperPendingEmbedding,
        id: "2401.00006",
        embedding: createMockEmbedding(1).map((v) => -v),
      };
      rerender({ papers: [...mockPapers, similarPaper, dissimilarPaper] });

      const idsAfter = result.current.results.map((r) => r.paper.id);
      expect(idsAfter).toContain("2401.00005");
      expect(idsAfter).not.toContain("2401.00006");
      expect(idsAfter).toHaveLength(idsBefore.length + 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("閾値を変更すると、検索APIを呼ばずに表示中の結果を再計算する", async () => {
      const { result, rerender } = renderHook(
        ({ scoreThreshold }: { scoreThreshold: number }) =>
          useSemanticSearch({ papers: mockPapers, scoreThreshold }),
        { initialProps: { scoreThreshold: 0.3 } }
      );

      await act(async () => {
        await result.current.search("transformer");
      });
      const countAtDefault = result.current.results.length;
      expect(countAtDefault).toBeGreaterThan(1);

      // クエリと同一の Embedding を持つ論文（スコア≒1）だけが残る閾値
      rerender({ scoreThreshold: 0.99 });

      expect(result.current.results.map((r) => r.paper.id)).toEqual(["2401.00001"]);
      expect(result.current.totalMatchCount).toBe(1);

      rerender({ scoreThreshold: 0.3 });

      expect(result.current.results).toHaveLength(countAtDefault);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("キー復号失敗（OperationError）時は、Embeddingなし論文があっても結果・検索対象外・総数がすべて空", async () => {
      // 復号失敗と同じ name の例外を検索経路で発生させる
      // （jsdom の DOMException は instanceof Error にならないため、name を設定した Error を使う）
      const decryptError = new Error("decrypt failed");
      decryptError.name = "OperationError";
      mockFetch.mockRejectedValue(decryptError);
      const { result, rerender } = renderWithPapers([...mockPapers, paperPendingEmbedding]);

      await act(async () => {
        await result.current.search("transformer");
      });

      // 空メッセージ表示用の stub が入り、検索済み扱いになる
      expect(result.current.expandedQuery).not.toBeNull();
      expect(result.current.error?.name).toBe("OperationError");
      expect(result.current.results).toEqual([]);
      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.totalMatchCount).toBe(0);

      // 論文が更新されても空のまま
      rerender({ papers: [...mockPapers, paperPendingEmbedding] });

      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.totalMatchCount).toBe(0);
    });

    it("保存済みデータでの検索も論文更新に追従し、検索APIを呼ばない", async () => {
      const { result, rerender } = renderWithPapers([...mockPapers, paperPendingEmbedding]);

      await act(async () => {
        await result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          mockSearchResponse.queryEmbedding
        );
      });
      expect(result.current.papersExcludedFromSearch).toHaveLength(1);

      rerender({
        papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
      });

      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.results.map((r) => r.paper.id)).toContain("2401.00004");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reset後に論文が更新されても結果は復活しない", async () => {
      const { result, rerender } = renderWithPapers([...mockPapers, paperPendingEmbedding]);

      await act(async () => {
        await result.current.search("transformer");
      });
      act(() => {
        result.current.reset();
      });

      rerender({
        papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.totalMatchCount).toBe(0);
    });

    it("検索中にresetし論文が更新された後で応答が届いても、結果を採用しない", async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );
      const { result, rerender } = renderWithPapers(mockPapers);

      act(() => {
        void result.current.search("transformer");
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      act(() => {
        result.current.reset();
      });
      rerender({ papers: [...mockPapers, paperPendingEmbedding] });

      await act(async () => {
        resolveFetch({ ok: true, json: () => Promise.resolve(mockSearchResponse) });
      });

      expect(result.current.expandedQuery).toBeNull();
      expect(result.current.results).toEqual([]);
      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.isLoading).toBe(false);
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
      expect(result.current.queryEmbedding).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
