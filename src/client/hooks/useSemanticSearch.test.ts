/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { parseISO } from "date-fns";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import type { PaperSearchSource } from "../lib/paperIndex/core";
import { createTestSearchSource } from "../testing/paperStoreTestUtils";
import { useSearchHistorySync } from "./useSearchHistorySync";
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
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.expandedQuery).toBeNull();
      expect(result.current.queryEmbedding).toBeNull();
    });
  });

  describe("検索実行", () => {
    it("計算中にしきい値が変わったら、最新の件数が確定するまで履歴を保存しない", async () => {
      type Matches = Awaited<ReturnType<PaperSearchSource["search"]>>;
      let resolveFirst!: (value: Matches) => void;
      let resolveLatest!: (value: Matches) => void;
      const first = new Promise<Matches>((resolve) => {
        resolveFirst = resolve;
      });
      const latest = new Promise<Matches>((resolve) => {
        resolveLatest = resolve;
      });
      const source = createTestSearchSource(mockPapers);
      const searchIndex = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(latest);
      const addHistory = vi.fn(async () => {});
      const { result, rerender } = renderHook(
        ({ scoreThreshold }) => {
          const search = useSemanticSearch({
            papers: mockPapers,
            searchSource: { ...source, search: searchIndex },
            scoreThreshold,
          });
          const query = useRef<string | null>("transformer");
          useSearchHistorySync(
            search.expandedQuery,
            search.queryEmbedding,
            search.totalMatchCount,
            search.resultsReady,
            query,
            addHistory
          );
          return search;
        },
        { initialProps: { scoreThreshold: 0.3 } }
      );

      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.search("transformer");
      });
      await waitFor(() => expect(searchIndex).toHaveBeenCalledTimes(1));
      rerender({ scoreThreshold: 0.99 });
      await act(async () => {
        resolveFirst({ matches: [], totalMatchCount: 2 });
      });
      await waitFor(() => expect(searchIndex).toHaveBeenCalledTimes(2));
      expect(searchIndex.mock.calls[1]?.[1]).toBe(0.99);
      expect(result.current.resultsReady).toBe(false);
      expect(addHistory).not.toHaveBeenCalled();

      await act(async () => {
        resolveLatest({ matches: [{ id: mockPapers[0].id, score: 1 }], totalMatchCount: 1 });
        await pending;
      });
      expect(result.current.resultsScoreThreshold).toBe(0.99);
      expect(result.current.resultsReady).toBe(true);
      expect(addHistory).toHaveBeenCalledTimes(1);
      expect(addHistory).toHaveBeenCalledWith(expect.objectContaining({ resultCount: 1 }));
    });

    it("search関数を呼ぶと検索APIが呼ばれる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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

      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      act(() => {
        result.current.search("transformer");
      });

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it("検索結果は類似度順にソートされる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.results[0]).toHaveProperty("paper");
      expect(result.current.results[0]).toHaveProperty("score");
      expect(result.current.results[0]?.paper).toHaveProperty("id");
      expect(result.current.results[0]?.paper).toHaveProperty("title");
    });

    it("拡張クエリが取得できる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.expandedQuery).toEqual(mockSearchResponse.expandedQuery);
    });

    it("queryEmbeddingが取得できる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.queryEmbedding).toEqual(mockSearchResponse.queryEmbedding);
    });
  });

  describe("保存済みデータでの検索", () => {
    it("searchWithSavedDataでAPIリクエストなしで検索できる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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

      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.error).toBeTruthy();
      expect(result.current.results).toEqual([]);
    });

    it("ネットワークエラー時にerrorが設定される", async () => {
      mockFetch.mockRejectedValue(new Error("Network Error"));

      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("transformer");
      });

      expect(result.current.error).toBeTruthy();
    });
  });

  describe("オプション", () => {
    it("limitオプションでAPIに渡す件数を変更できる", async () => {
      const { result } = renderHook(() =>
        useSemanticSearch({
          papers: mockPapers,
          limit: 50,
          searchSource: createTestSearchSource(mockPapers),
        })
      );

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

      const { result } = renderHook(() =>
        useSemanticSearch({
          papers: papersWithoutEmbedding,
          searchSource: createTestSearchSource(papersWithoutEmbedding),
        })
      );

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

      const { result } = renderHook(() =>
        useSemanticSearch({
          papers: papersWithOneExcluded,
          searchSource: createTestSearchSource(papersWithOneExcluded),
        })
      );

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
      renderHook(
        ({ papers }: { papers: Paper[] }) =>
          useSemanticSearch({ papers, searchSource: createTestSearchSource(papers) }),
        {
          initialProps: { papers: initialPapers },
        }
      );

    it("検索表示中にEmbeddingを補完すると、検索対象外から外れてスコアに応じて結果に入る", async () => {
      const { result, rerender } = renderWithPapers([...mockPapers, paperPendingEmbedding]);

      await act(async () => {
        await result.current.search("transformer");
      });
      expect(result.current.papersExcludedFromSearch.map((p) => p.id)).toEqual(["2401.00004"]);
      expect(result.current.results.map((r) => r.paper.id)).not.toContain("2401.00004");
      const totalBefore = result.current.totalMatchCount;

      await act(async () => {
        rerender({
          papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
        });
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
        ({ papers }: { papers: Paper[] }) =>
          useSemanticSearch({ papers, limit, searchSource: createTestSearchSource(papers) }),
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
      await act(async () => {
        rerender({ papers: [...mockPapers, similarPaper, dissimilarPaper] });
      });

      const idsAfter = result.current.results.map((r) => r.paper.id);
      expect(idsAfter).toContain("2401.00005");
      expect(idsAfter).not.toContain("2401.00006");
      expect(idsAfter).toHaveLength(idsBefore.length + 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("閾値を変更すると、検索APIを呼ばずに表示中の結果を再計算する", async () => {
      const { result, rerender } = renderHook(
        ({ scoreThreshold }: { scoreThreshold: number }) =>
          useSemanticSearch({
            papers: mockPapers,
            scoreThreshold,
            searchSource: createTestSearchSource(mockPapers),
          }),
        { initialProps: { scoreThreshold: 0.3 } }
      );

      await act(async () => {
        await result.current.search("transformer");
      });
      const countAtDefault = result.current.results.length;
      expect(countAtDefault).toBeGreaterThan(1);
      expect(result.current.resultsScoreThreshold).toBe(0.3);

      // クエリと同一の Embedding を持つ論文（スコア≒1）だけが残る閾値
      await act(async () => {
        rerender({ scoreThreshold: 0.99 });
      });

      expect(result.current.results.map((r) => r.paper.id)).toEqual(["2401.00001"]);
      expect(result.current.totalMatchCount).toBe(1);
      // 表示中の結果を計算したしきい値（空状態の案内文に使う）
      expect(result.current.resultsScoreThreshold).toBe(0.99);

      await act(async () => {
        rerender({ scoreThreshold: 0.3 });
      });

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
      await act(async () => {
        rerender({ papers: [...mockPapers, paperPendingEmbedding] });
      });

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

      await act(async () => {
        rerender({
          papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
        });
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

      await act(async () => {
        rerender({
          papers: [...mockPapers, { ...paperPendingEmbedding, embedding: createMockEmbedding(1) }],
        });
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
      await act(async () => {
        rerender({ papers: [...mockPapers, paperPendingEmbedding] });
      });

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
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

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

  describe("保存済み論文の読み込み中（#65）", () => {
    /** 全件準備の完了・失敗をテストから制御できる検索の実行元 */
    const createPendingSource = () => {
      let ready = false;
      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = () => {
          ready = true;
          resolve();
        };
        rejectReady = reject;
      });
      const base = createTestSearchSource(mockPapers);
      const source: PaperSearchSource = {
        isReady: () => ready,
        whenReady: () => readyPromise,
        search: base.search,
      };
      return { source, resolveReady, rejectReady };
    };

    it("全件の準備完了までは結果を確定せず、完了後に全件に対する結果を返す", async () => {
      const pending = createPendingSource();
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: pending.source })
      );

      let searching!: Promise<unknown>;
      act(() => {
        searching = result.current.search("transformer");
      });
      await waitFor(() => expect(result.current.isWaitingForPapers).toBe(true));
      expect(result.current.isLoading).toBe(true);
      expect(result.current.resultsReady).toBe(false);
      expect(result.current.results).toEqual([]);
      expect(result.current.papersExcludedFromSearch).toEqual([]);
      expect(result.current.totalMatchCount).toBe(0);

      await act(async () => {
        pending.resolveReady();
        await searching;
      });

      expect(result.current.searchPhase).toBe("done");
      expect(result.current.resultsReady).toBe(true);
      expect(result.current.isWaitingForPapers).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results[0]?.paper.id).toBe("2401.00001");
      expect(result.current.totalMatchCount).toBeGreaterThan(0);
    });

    it("履歴からの検索も全件の準備完了まで結果を確定しない", async () => {
      const pending = createPendingSource();
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: pending.source })
      );

      let searching!: Promise<unknown>;
      act(() => {
        searching = result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          mockSearchResponse.queryEmbedding
        );
      });
      expect(result.current.isWaitingForPapers).toBe(true);
      expect(result.current.resultsReady).toBe(false);

      await act(async () => {
        pending.resolveReady();
        await searching;
      });
      expect(result.current.resultsReady).toBe(true);
      expect(result.current.results.length).toBeGreaterThan(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("再読み込み中の論文更新では索引を検索せず、準備完了で1回だけ再計算する", async () => {
      let ready = true;
      let resolveReady: () => void = () => {};
      let readyPromise = Promise.resolve();
      const base = createTestSearchSource(mockPapers);
      const searchSpy = vi.fn(base.search);
      const source: PaperSearchSource = {
        isReady: () => ready,
        whenReady: () => readyPromise,
        search: searchSpy,
      };
      const { result, rerender } = renderHook(
        ({ papers }: { papers: Paper[] }) => useSemanticSearch({ papers, searchSource: source }),
        { initialProps: { papers: mockPapers as Paper[] } }
      );
      await act(async () => {
        await result.current.search("transformer");
      });
      expect(searchSpy).toHaveBeenCalledTimes(1);

      // 再試行で読み込み直している間に、バッチが届くたびに一覧が更新される
      ready = false;
      readyPromise = new Promise<void>((resolve) => {
        resolveReady = () => {
          ready = true;
          resolve();
        };
      });
      await act(async () => {
        rerender({ papers: [...mockPapers] });
      });
      await act(async () => {
        rerender({ papers: [...mockPapers] });
      });
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(result.current.searchPhase).toBe("done");
      expect(result.current.results.length).toBeGreaterThan(0);

      await act(async () => {
        resolveReady();
      });
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
      expect(result.current.searchPhase).toBe("done");
      expect(result.current.results[0]?.paper.id).toBe("2401.00001");
    });

    it("読み込みに失敗すると、検索をエラーにして結果を確定しない", async () => {
      const pending = createPendingSource();
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: pending.source })
      );

      let searching!: Promise<unknown>;
      act(() => {
        searching = result.current.search("transformer");
      });
      await waitFor(() => expect(result.current.isWaitingForPapers).toBe(true));

      const loadError = new Error("IndexedDB が開けません");
      loadError.name = "PaperLoadError";
      await act(async () => {
        pending.rejectReady(loadError);
        await searching;
      });

      expect(result.current.searchPhase).toBe("error");
      expect(result.current.error?.name).toBe("PaperLoadError");
      expect(result.current.resultsReady).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toEqual([]);
    });
  });

  describe("確定した結果の再計算の失敗（#100）", () => {
    /** 新しく追加され、クエリと高い類似度になる論文 */
    const addedPaper: Paper = {
      ...mockPapers[0],
      id: "2401.00009",
      title: "Added Paper",
    };

    /** 確定後の再計算（索引の検索・全件準備）の失敗をテストから切り替えられる検索の実行元 */
    const renderControlled = () => {
      const control = {
        failCompute: false,
        ready: true,
        loadError: null as Error | null,
        /** 設定すると、次の索引の検索はこの Promise の解決まで応答を返さない */
        hold: null as Promise<void> | null,
      };
      const base = createTestSearchSource([...mockPapers, addedPaper]);
      const searchSpy = vi.fn(async (...args: Parameters<PaperSearchSource["search"]>) => {
        const failing = control.failCompute;
        const hold = control.hold;
        control.hold = null;
        if (hold) await hold;
        if (failing) throw new Error("worker crashed");
        return base.search(...args);
      });
      const whenReadySpy = vi.fn(async () => {
        if (control.loadError) throw control.loadError;
      });
      const source: PaperSearchSource = {
        isReady: () => control.ready,
        whenReady: whenReadySpy,
        search: searchSpy,
      };
      const view = renderHook(
        ({ papers, scoreThreshold }: { papers: Paper[]; scoreThreshold: number }) =>
          useSemanticSearch({ papers, scoreThreshold, searchSource: source }),
        { initialProps: { papers: mockPapers as Paper[], scoreThreshold: 0.3 } }
      );
      return { ...view, control, searchSpy, whenReadySpy };
    };

    /** 保留中の Promise・effect をすべて流す */
    const flush = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    };

    it("再計算が失敗しても新しい検索の失敗にせず、表示中の結果を残して recomputeError に出す", async () => {
      const { result, rerender, control } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      const shownIds = result.current.results.map((r) => r.paper.id);

      control.failCompute = true;
      rerender({ papers: [...mockPapers, addedPaper], scoreThreshold: 0.3 });

      await waitFor(() => expect(result.current.recomputeError?.name).toBe("SearchComputeError"));
      expect(result.current.searchPhase).toBe("done");
      expect(result.current.error).toBeNull();
      expect(result.current.isShowingPreviousResults).toBe(false);
      expect(result.current.resultsReady).toBe(true);
      expect(result.current.resultQuery).toBe("transformer");
      expect(result.current.results.map((r) => r.paper.id)).toEqual(shownIds);
    });

    it("同じ入力のままでは失敗した再計算を自動で繰り返さない", async () => {
      const { result, rerender, control, searchSpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      control.failCompute = true;
      const nextPapers = [...mockPapers, addedPaper];
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());
      expect(searchSpy).toHaveBeenCalledTimes(2);

      await flush();
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });
      await flush();

      expect(searchSpy).toHaveBeenCalledTimes(2);
      expect(result.current.recomputeError).not.toBeNull();
    });

    it("再計算の失敗後に新しい検索を中止して表示中の結果に戻っても、同じ入力の再計算を自動で繰り返さない", async () => {
      const { result, rerender, control, searchSpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      control.failCompute = true;
      rerender({ papers: [...mockPapers, addedPaper], scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());
      expect(searchSpy).toHaveBeenCalledTimes(2);

      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      act(() => {
        void result.current.search("bert");
      });
      // 新しい検索の実行中は再計算の失敗を出さない（新しい検索の状態を示す）
      expect(result.current.recomputeError).toBeNull();
      act(() => {
        result.current.cancel();
      });
      await flush();

      expect(searchSpy).toHaveBeenCalledTimes(2);
      expect(result.current.searchPhase).toBe("done");
      expect(result.current.recomputeError?.name).toBe("SearchComputeError");
    });

    it("失敗した入力に戻ったら、途中の入力で実行中だった再計算の結果を採用しない（A→B→A）", async () => {
      const { result, rerender, control, searchSpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      const shownIds = result.current.results.map((r) => r.paper.id);
      control.failCompute = true;
      const failedPapers = [...mockPapers, addedPaper];
      rerender({ papers: failedPapers, scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());

      // B（しきい値の変更）の再計算は成功するが、応答を保留する
      control.failCompute = false;
      let releaseB!: () => void;
      control.hold = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      rerender({ papers: failedPapers, scoreThreshold: 0.4 });
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(3));

      // 失敗した入力 A に戻す
      rerender({ papers: failedPapers, scoreThreshold: 0.3 });
      await act(async () => {
        releaseB();
      });
      await flush();

      expect(result.current.resultsScoreThreshold).toBe(0.3);
      expect(result.current.results.map((r) => r.paper.id)).toEqual(shownIds);
      expect(result.current.recomputeError?.name).toBe("SearchComputeError");
      expect(searchSpy).toHaveBeenCalledTimes(3);
    });

    it("retryRecompute で再計算だけをやり直す（検索APIは呼ばない）。失敗が続いても1操作1回", async () => {
      const { result, rerender, control, searchSpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      control.failCompute = true;
      rerender({ papers: [...mockPapers, addedPaper], scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());

      act(() => {
        result.current.retryRecompute();
      });
      await flush();
      expect(searchSpy).toHaveBeenCalledTimes(3);
      expect(result.current.recomputeError?.name).toBe("SearchComputeError");

      control.failCompute = false;
      act(() => {
        result.current.retryRecompute();
      });

      // retryRecompute は失敗の記録を同期で消すため、再計算の結果が反映されるまで待つ
      await waitFor(() =>
        expect(result.current.results.map((r) => r.paper.id)).toContain(addedPaper.id)
      );
      expect(result.current.recomputeError).toBeNull();
      expect(searchSpy).toHaveBeenCalledTimes(4);
      expect(result.current.searchPhase).toBe("done");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("入力（論文・しきい値）が変われば再計算する", async () => {
      const { result, rerender, control, searchSpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      control.failCompute = true;
      rerender({ papers: [...mockPapers, addedPaper], scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());
      expect(searchSpy).toHaveBeenCalledTimes(2);

      const nextPapers = [...mockPapers, addedPaper];
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });
      await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(3));

      control.failCompute = false;
      rerender({ papers: nextPapers, scoreThreshold: 0.4 });
      await waitFor(() => expect(result.current.resultsScoreThreshold).toBe(0.4));
      expect(result.current.recomputeError).toBeNull();
      expect(searchSpy).toHaveBeenCalledTimes(4);
    });

    it("再読み込みの失敗も再計算の失敗として扱い、同じ入力では読み込みの完了を待ち直さない", async () => {
      const { result, rerender, control, whenReadySpy } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      const readyCalls = whenReadySpy.mock.calls.length;

      control.ready = false;
      control.loadError = Object.assign(new Error("db"), { name: "PaperLoadError" });
      const nextPapers = [...mockPapers, addedPaper];
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });

      await waitFor(() => expect(result.current.recomputeError?.name).toBe("PaperLoadError"));
      expect(result.current.error).toBeNull();
      expect(result.current.searchPhase).toBe("done");
      expect(whenReadySpy).toHaveBeenCalledTimes(readyCalls + 1);

      await flush();
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });
      await flush();
      expect(whenReadySpy).toHaveBeenCalledTimes(readyCalls + 1);
    });

    it("新しい検索が確定したら再計算の失敗を出さない", async () => {
      const { result, rerender, control } = renderControlled();
      await act(async () => {
        await result.current.search("transformer");
      });
      control.failCompute = true;
      const nextPapers = [...mockPapers, addedPaper];
      rerender({ papers: nextPapers, scoreThreshold: 0.3 });
      await waitFor(() => expect(result.current.recomputeError).not.toBeNull());

      control.failCompute = false;
      await act(async () => {
        await result.current.search("bert");
      });

      expect(result.current.recomputeError).toBeNull();
      expect(result.current.searchPhase).toBe("done");
    });
  });

  describe("検索中・失敗時の前回の結果の保持（#71）", () => {
    /** 検索APIの応答（Response） */
    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    /** 1回目は成功させ、前回の結果がある状態にする */
    const searchFirst = async () => {
      const view = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );
      await act(async () => {
        await view.result.current.search("transformer");
      });
      expect(view.result.current.results.length).toBeGreaterThan(0);
      return view;
    };

    it("新しい検索の実行中は前回の結果を消さず、前回の結果であることを示す", async () => {
      const { result } = await searchFirst();
      const previousIds = result.current.results.map((r) => r.paper.id);
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      act(() => {
        void result.current.search("bert");
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isShowingPreviousResults).toBe(true);
      expect(result.current.resultQuery).toBe("transformer");
      expect(result.current.results.map((r) => r.paper.id)).toEqual(previousIds);
    });

    it.each([
      ["401", () => jsonResponse({ error: "Incorrect API key" }, 401), 401],
      ["429（プレーンテキスト）", () => new Response("Too many requests", { status: 429 }), 429],
      ["500", () => jsonResponse({ error: "upstream" }, 500), 500],
    ])("失敗（%s）しても前回の結果を保持し、status 付きのエラーにする。自動では再試行しない", async (_label, failure, status) => {
      const { result } = await searchFirst();
      const previousIds = result.current.results.map((r) => r.paper.id);
      mockFetch.mockResolvedValueOnce(failure());

      await act(async () => {
        await result.current.search("bert");
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toMatchObject({ name: "SearchApiError", status });
      expect(result.current.isShowingPreviousResults).toBe(true);
      expect(result.current.resultQuery).toBe("transformer");
      expect(result.current.results.map((r) => r.paper.id)).toEqual(previousIds);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("前回の結果がない検索の失敗では、前回の結果として示さない", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Too many requests", { status: 429 }));
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: createTestSearchSource(mockPapers) })
      );

      await act(async () => {
        await result.current.search("bert");
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.isShowingPreviousResults).toBe(false);
      expect(result.current.resultQuery).toBeNull();
      expect(result.current.results).toEqual([]);
    });

    it("cancel で通信を中止し、前回の結果に戻る。後から届いた応答は採用しない", async () => {
      const { result } = await searchFirst();
      const previousIds = result.current.results.map((r) => r.paper.id);
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );

      act(() => {
        void result.current.search("bert");
      });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      act(() => {
        result.current.cancel();
      });

      const init = mockFetch.mock.calls[1]?.[1] as RequestInit;
      expect(init.signal?.aborted).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isShowingPreviousResults).toBe(false);
      expect(result.current.resultQuery).toBe("transformer");

      await act(async () => {
        resolveFetch(
          jsonResponse({
            ...mockSearchResponse,
            expandedQuery: { ...mockSearchResponse.expandedQuery, original: "bert" },
            queryEmbedding: createMockEmbedding(100),
          })
        );
      });

      expect(result.current.resultQuery).toBe("transformer");
      expect(result.current.expandedQuery?.original).toBe("transformer");
      expect(result.current.results.map((r) => r.paper.id)).toEqual(previousIds);
    });
  });

  describe("索引での計算の中止（#111）", () => {
    type Matches = Awaited<ReturnType<PaperSearchSource["search"]>>;

    /** 結果をテストから返し、signal で中止されたら AbortError で reject する検索の実行元 */
    const createAbortableSource = () => {
      const calls: { signal?: AbortSignal; resolve: (matches: Matches) => void }[] = [];
      const source: PaperSearchSource = {
        isReady: () => true,
        whenReady: async () => {},
        search: (_queryEmbedding, _scoreThreshold, _limit, signal) =>
          new Promise<Matches>((resolve, reject) => {
            calls.push({ signal, resolve });
            signal?.addEventListener("abort", () =>
              reject(new DOMException("検索を中止しました", "AbortError"))
            );
          }),
      };
      return { source, calls };
    };

    it("cancel で実行中の索引での計算を中止し、中止による失敗をエラーにしない", async () => {
      const { source, calls } = createAbortableSource();
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: source })
      );

      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          createMockEmbedding(1)
        );
      });
      await waitFor(() => expect(calls).toHaveLength(1));
      act(() => {
        result.current.cancel();
      });
      await act(async () => {
        await pending;
      });

      expect(calls[0]?.signal?.aborted).toBe(true);
      expect(result.current.searchPhase).toBe("idle");
      expect(result.current.error).toBeNull();
      expect(result.current.results).toEqual([]);
    });

    it("新しい検索を始めると前の計算を中止し、新しい検索の結果だけを確定する", async () => {
      const { source, calls } = createAbortableSource();
      const { result } = renderHook(() =>
        useSemanticSearch({ papers: mockPapers, searchSource: source })
      );

      act(() => {
        void result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          createMockEmbedding(1),
          "first"
        );
      });
      await waitFor(() => expect(calls).toHaveLength(1));
      let second!: Promise<unknown>;
      act(() => {
        second = result.current.searchWithSavedData(
          { ...mockSearchResponse.expandedQuery, original: "second" },
          createMockEmbedding(100),
          "second"
        );
      });
      await waitFor(() => expect(calls).toHaveLength(2));

      expect(calls[0]?.signal?.aborted).toBe(true);
      expect(calls[1]?.signal?.aborted).toBe(false);
      await act(async () => {
        calls[1]?.resolve({
          matches: [{ id: "2401.00003", score: 0.9 }],
          totalMatchCount: 1,
        });
        await second;
      });

      expect(result.current.error).toBeNull();
      expect(result.current.searchPhase).toBe("done");
      expect(result.current.resultQuery).toBe("second");
      expect(result.current.results.map((r) => r.paper.id)).toEqual(["2401.00003"]);
    });

    it("再計算中に論文が更新されると前の再計算を中止し、中止を再計算の失敗にしない", async () => {
      const { source, calls } = createAbortableSource();
      const { result, rerender } = renderHook(
        ({ papers }) => useSemanticSearch({ papers, searchSource: source }),
        { initialProps: { papers: mockPapers } }
      );

      let first!: Promise<unknown>;
      act(() => {
        first = result.current.searchWithSavedData(
          mockSearchResponse.expandedQuery,
          createMockEmbedding(1)
        );
      });
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        calls[0]?.resolve({ matches: [{ id: "2401.00001", score: 0.9 }], totalMatchCount: 1 });
        await first;
      });
      expect(result.current.searchPhase).toBe("done");

      rerender({ papers: [...mockPapers] });
      await waitFor(() => expect(calls).toHaveLength(2));
      rerender({ papers: [...mockPapers] });
      await waitFor(() => expect(calls).toHaveLength(3));

      expect(calls[1]?.signal?.aborted).toBe(true);
      expect(calls[2]?.signal?.aborted).toBe(false);
      // 中止した再計算の reject を反映させてから確認する
      await act(async () => {});
      expect(result.current.recomputeError).toBeNull();
      expect(result.current.searchPhase).toBe("done");

      await act(async () => {
        calls[2]?.resolve({ matches: [{ id: "2401.00002", score: 0.8 }], totalMatchCount: 1 });
      });
      expect(result.current.recomputeError).toBeNull();
      expect(result.current.results.map((r) => r.paper.id)).toEqual(["2401.00002"]);
    });
  });
});
