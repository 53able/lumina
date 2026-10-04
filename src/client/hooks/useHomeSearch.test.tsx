/**
 * @vitest-environment jsdom
 *
 * 検索入口（入力・URL・履歴・クリア）と検索API呼び出し回数・応答採用の結合テスト。
 * URL 同期（usePaperFilter / react-router）と useSemanticSearch は実物を使い、API だけをモックする。
 */
import { act, configure, renderHook, waitFor } from "@testing-library/react";
import { parseISO } from "date-fns";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpandedQuery, Paper, SearchHistory } from "../../shared/schemas/index";
import type { PaperSearchSource } from "../lib/paperIndex/core";
import { createTestSearchSource } from "../testing/paperStoreTestUtils";
import { useHomeSearch } from "./useHomeSearch";
import { usePaperFilter } from "./usePaperFilter";

const mockSearchApi = vi.fn();
vi.mock("../lib/api", () => ({
  getDecryptedApiKey: vi.fn(async () => "sk-test"),
  searchApi: (...args: unknown[]) => mockSearchApi(...args),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const embedding = [0.1, 0.2, 0.3];

const papers: Paper[] = [
  {
    id: "2401.00001",
    title: "Quantum Error Correction",
    abstract: "abstract",
    authors: ["A"],
    categories: ["quant-ph"],
    publishedAt: parseISO("2024-01-01"),
    updatedAt: parseISO("2024-01-01"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding,
  },
];

const expanded = (query: string): ExpandedQuery => ({
  original: query,
  english: query,
  synonyms: [],
  searchText: query,
});

const response = (query: string) => ({ expandedQuery: expanded(query), queryEmbedding: embedding });

/** 外部から解決できる Promise（応答順の制御用） */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderHomeSearch = ({
  initialUrl = "/",
  initialPapers = papers,
  savedHistories = [],
  searchSource,
}: {
  initialUrl?: string;
  initialPapers?: Paper[];
  savedHistories?: SearchHistory[];
  /** 検索の実行元（省略時は渡した論文を全件準備済みとして検索する） */
  searchSource?: PaperSearchSource;
} = {}) => {
  const findSavedHistory = (query: string) => savedHistories.find((h) => h.originalQuery === query);
  const addHistory = vi.fn(async (_history: SearchHistory) => {});
  const wrapper = ({ children }: { children: ReactNode }) => {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
  const view = renderHook(
    ({ papers: currentPapers }: { papers: Paper[] }) => ({
      home: useHomeSearch({
        papers: currentPapers,
        addHistory,
        findSavedHistory,
        searchSource: searchSource ?? createTestSearchSource(currentPapers),
      }),
      filter: usePaperFilter(),
      location: useLocation(),
    }),
    { wrapper, initialProps: { papers: initialPapers } }
  );
  /** PaperExplorer の「クリア」と同じ操作（URL の検索語・フィルターを消してから onClear） */
  const clear = () => {
    act(() => {
      view.result.current.filter.clearSearchAndFilters();
      view.result.current.home.handleClearSearch();
    });
  };
  return { ...view, addHistory, clear };
};

describe("useHomeSearch", () => {
  beforeEach(() => {
    mockSearchApi.mockReset();
  });

  describe("1操作1検索（#33）", () => {
    it("入力から検索すると URL を更新し、検索APIは1回だけ呼ばれる", async () => {
      mockSearchApi.mockResolvedValue(response("量子誤り訂正"));
      const { result, addHistory } = renderHomeSearch();

      await act(async () => {
        await result.current.home.handleSearch("量子誤り訂正");
      });

      await waitFor(() => expect(result.current.home.expandedQuery?.original).toBe("量子誤り訂正"));
      expect(result.current.location.search).toBe(`?q=${encodeURIComponent("量子誤り訂正")}`);
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
      expect(addHistory).toHaveBeenCalledTimes(1);
    });

    it("?q= を直接開くと検索APIは1回だけ呼ばれ、完了する（StrictMode の effect 二重実行下）", async () => {
      // renderHook の wrapper に StrictMode を渡すだけでは effect が二重実行されないため、設定で有効にする
      configure({ reactStrictMode: true });
      try {
        mockSearchApi.mockResolvedValue(response("transformer"));
        const { result } = renderHomeSearch({ initialUrl: "/?q=transformer" });

        await waitFor(() => expect(result.current.home.completedQuery).toBe("transformer"));
        expect(result.current.home.isLoading).toBe(false);
        expect(result.current.home.results).toHaveLength(1);
        expect(result.current.home.searchInputValue).toBe("transformer");
        expect(mockSearchApi).toHaveBeenCalledTimes(1);
      } finally {
        configure({ reactStrictMode: false });
      }
    });

    it("URL の q に前後の空白があっても1回だけ検索する", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const { result } = renderHomeSearch({ initialUrl: "/?q=%20transformer%20" });

      await waitFor(() => expect(result.current.home.completedQuery).toBe("transformer"));
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("検索後に論文一覧が更新されても同じクエリを再検索しない", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const { result, rerender } = renderHomeSearch({ initialUrl: "/?q=transformer" });
      await waitFor(() => expect(result.current.home.expandedQuery).not.toBeNull());

      rerender({ papers: [...papers] });

      await waitFor(() => expect(result.current.home.isLoading).toBe(false));
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("URL 起点の検索後に論文追加・Embedding補完があると、検索APIを呼ばずに結果へ反映する（#45）", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const pendingPaper: Paper = {
        ...(papers[0] as Paper),
        id: "2401.00002",
        embedding: undefined,
      };
      const { result, rerender, addHistory } = renderHomeSearch({
        initialUrl: "/?q=transformer",
        initialPapers: [...papers, pendingPaper],
      });
      await waitFor(() => expect(result.current.home.completedQuery).toBe("transformer"));
      expect(result.current.home.papersExcludedFromSearch.map((p) => p.id)).toEqual(["2401.00002"]);

      const addedPaper: Paper = { ...(papers[0] as Paper), id: "2401.00003" };
      await act(async () => {
        rerender({ papers: [...papers, { ...pendingPaper, embedding }, addedPaper] });
      });

      expect(result.current.home.papersExcludedFromSearch).toEqual([]);
      expect(result.current.home.results.map((r) => r.paper.id)).toEqual(
        expect.arrayContaining(["2401.00001", "2401.00002", "2401.00003"])
      );
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
      expect(addHistory).toHaveBeenCalledTimes(1);
    });

    it("保存済みEmbeddingの履歴再検索は URL を更新しても検索APIを呼ばない", async () => {
      const { result } = renderHomeSearch();
      const history: SearchHistory = {
        id: "h1",
        originalQuery: "履歴の語",
        expandedQuery: expanded("履歴の語"),
        queryEmbedding: embedding,
        resultCount: 1,
        createdAt: new Date(),
      };

      act(() => {
        result.current.home.handleReSearch(history);
      });

      // 結果の確定（索引での計算）は非同期のため、完了クエリが揃うまで待つ
      await waitFor(() => expect(result.current.home.completedQuery).toBe("履歴の語"));
      expect(result.current.home.expandedQuery?.original).toBe("履歴の語");
      expect(result.current.location.search).toBe(`?q=${encodeURIComponent("履歴の語")}`);
      expect(result.current.home.results).toHaveLength(1);
      expect(mockSearchApi).not.toHaveBeenCalled();
    });
  });

  describe("URL・表示クエリの扱い", () => {
    it("保存済み履歴のあるクエリを URL から開くと（画面復帰など）、検索APIを呼ばない", async () => {
      const saved: SearchHistory = {
        id: "h1",
        originalQuery: "保存済み",
        expandedQuery: expanded("保存済み"),
        queryEmbedding: embedding,
        resultCount: 1,
        createdAt: new Date(),
      };
      const { result } = renderHomeSearch({
        initialUrl: `/?q=${encodeURIComponent("保存済み")}`,
        savedHistories: [saved],
      });

      await waitFor(() => expect(result.current.home.completedQuery).toBe("保存済み"));
      expect(result.current.home.results).toHaveLength(1);
      expect(mockSearchApi).not.toHaveBeenCalled();
    });

    it("API が返す expandedQuery.original が入力と異なっても、完了クエリは入力のまま", async () => {
      mockSearchApi.mockResolvedValue({
        expandedQuery: { ...expanded("quantum error correction"), original: "量子 誤り訂正" },
        queryEmbedding: embedding,
      });
      const { result } = renderHomeSearch();

      await act(async () => {
        await result.current.home.handleSearch("量子誤り訂正");
      });

      await waitFor(() => expect(result.current.home.completedQuery).toBe("量子誤り訂正"));
      expect(result.current.filter.searchQuery).toBe("量子誤り訂正");
    });

    it("検索中は完了クエリが null（前の検索結果を新しい見出しの下に出さない）", async () => {
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockResolvedValueOnce(response("A")).mockReturnValueOnce(pending.promise);
      const { result } = renderHomeSearch();
      await act(async () => {
        await result.current.home.handleSearch("A");
      });
      expect(result.current.home.completedQuery).toBe("A");

      act(() => {
        void result.current.home.handleSearch("B");
      });

      expect(result.current.home.completedQuery).toBeNull();
      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
      await waitFor(() => expect(result.current.home.completedQuery).toBe("B"));
    });

    it("検索中にアンマウントすると通信を中止する", async () => {
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);
      const { result, unmount } = renderHomeSearch();
      act(() => {
        void result.current.home.handleSearch("A");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));

      unmount();

      const [, options] = mockSearchApi.mock.calls[0] as [unknown, { signal: AbortSignal }];
      expect(options.signal.aborted).toBe(true);
    });
  });

  describe("絞り込みの解除（#46）", () => {
    it("検索結果の表示中に絞り込みを解除しても、検索語・結果・見出しを維持する", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const { result } = renderHomeSearch();
      await act(async () => {
        await result.current.home.handleSearch("transformer");
      });
      await waitFor(() => expect(result.current.home.completedQuery).toBe("transformer"));
      act(() => {
        result.current.filter.toggleCategory("quant-ph");
      });

      act(() => {
        result.current.filter.clearAllFilters();
      });

      // 見出しは URL の q から作られる
      expect(result.current.location.search).toBe("?q=transformer");
      expect(result.current.filter.searchQuery).toBe("transformer");
      expect(result.current.filter.selectedCategories.size).toBe(0);
      expect(result.current.home.completedQuery).toBe("transformer");
      expect(result.current.home.expandedQuery?.original).toBe("transformer");
      expect(result.current.home.results).toHaveLength(1);
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("検索中に絞り込みを解除しても、応答後の検索語・結果・履歴が URL と一致する", async () => {
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);
      const { result, addHistory } = renderHomeSearch({ initialUrl: "/?cat=quant-ph" });

      act(() => {
        result.current.home.setSearchInputValue("遅い検索");
        void result.current.home.handleSearch("遅い検索");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));

      act(() => {
        result.current.filter.clearAllFilters();
      });
      expect(result.current.filter.searchQuery).toBe("遅い検索");
      expect(result.current.home.isLoading).toBe(true);

      await act(async () => {
        pending.resolve(response("遅い検索"));
        await pending.promise;
      });

      await waitFor(() => expect(result.current.home.completedQuery).toBe("遅い検索"));
      expect(result.current.location.search).toBe(`?q=${encodeURIComponent("遅い検索")}`);
      expect(result.current.home.searchInputValue).toBe("遅い検索");
      expect(result.current.home.results).toHaveLength(1);
      expect(addHistory).toHaveBeenCalledTimes(1);
      expect(addHistory.mock.calls[0]?.[0].originalQuery).toBe("遅い検索");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });
  });

  describe("古い応答の破棄（#34）", () => {
    it("検索中にクリアすると、後から届いた応答で URL・入力・結果・履歴が復活しない", async () => {
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);
      const { result, addHistory, clear } = renderHomeSearch();

      act(() => {
        result.current.home.setSearchInputValue("遅い検索");
        void result.current.home.handleSearch("遅い検索");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));
      expect(result.current.home.isLoading).toBe(true);

      clear();
      expect(result.current.location.search).toBe("");
      expect(result.current.home.isLoading).toBe(false);
      expect(result.current.home.searchInputValue).toBe("");

      await act(async () => {
        pending.resolve(response("遅い検索"));
        await pending.promise;
      });

      expect(result.current.location.search).toBe("");
      expect(result.current.home.searchInputValue).toBe("");
      expect(result.current.home.expandedQuery).toBeNull();
      expect(result.current.home.results).toHaveLength(0);
      expect(result.current.home.isLoading).toBe(false);
      expect(addHistory).not.toHaveBeenCalled();
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
      // クリア時は通信も中止する
      const [, options] = mockSearchApi.mock.calls[0] as [unknown, { signal: AbortSignal }];
      expect(options.signal.aborted).toBe(true);
    });

    it("検索A→検索Bを開始し B→A の順に完了しても B を維持する", async () => {
      const a = deferred<ReturnType<typeof response>>();
      const b = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const { result, addHistory } = renderHomeSearch();

      act(() => {
        void result.current.home.handleSearch("A");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));
      act(() => {
        void result.current.home.handleSearch("B");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));

      await act(async () => {
        b.resolve(response("B"));
        await b.promise;
      });
      await waitFor(() => expect(result.current.home.expandedQuery?.original).toBe("B"));

      await act(async () => {
        a.resolve(response("A"));
        await a.promise;
      });

      expect(result.current.home.expandedQuery?.original).toBe("B");
      expect(result.current.location.search).toBe("?q=B");
      expect(addHistory).toHaveBeenCalledTimes(1);
      expect(addHistory.mock.calls[0]?.[0].originalQuery).toBe("B");
      expect(mockSearchApi).toHaveBeenCalledTimes(2);
    });

    it("検索A→履歴Bの順に開始し、A が後から完了しても B を維持する", async () => {
      const a = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(a.promise);
      const { result } = renderHomeSearch();

      act(() => {
        void result.current.home.handleSearch("A");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));
      act(() => {
        result.current.home.handleReSearch({
          id: "h1",
          originalQuery: "B",
          expandedQuery: expanded("B"),
          queryEmbedding: embedding,
          resultCount: 1,
          createdAt: new Date(),
        });
      });
      await waitFor(() => expect(result.current.home.expandedQuery?.original).toBe("B"));

      await act(async () => {
        a.resolve(response("A"));
        await a.promise;
      });

      expect(result.current.home.expandedQuery?.original).toBe("B");
      expect(result.current.home.searchInputValue).toBe("B");
      expect(result.current.location.search).toBe("?q=B");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("古い検索の失敗・終了が新しい検索のエラー表示と実行中表示を壊さない", async () => {
      const a = deferred<ReturnType<typeof response>>();
      const b = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const { result } = renderHomeSearch();

      act(() => {
        void result.current.home.handleSearch("A");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(1));
      act(() => {
        void result.current.home.handleSearch("B");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));

      await act(async () => {
        a.reject(new Error("A failed"));
        await a.promise.catch(() => {});
      });

      expect(result.current.home.error).toBeNull();
      expect(result.current.home.isLoading).toBe(true);

      await act(async () => {
        b.resolve(response("B"));
        await b.promise;
      });
      await waitFor(() => expect(result.current.home.isLoading).toBe(false));
      expect(result.current.home.expandedQuery?.original).toBe("B");
      expect(result.current.home.error).toBeNull();
    });
  });

  describe("変換文を編集して再検索（#31）", () => {
    const expandedWithSynonyms: ExpandedQuery = {
      original: "深層学習",
      english: "deep learning",
      synonyms: ["neural network", "representation learning"],
      searchText: "deep learning neural network representation learning",
    };
    /** サーバーは embeddingText を searchText として返す */
    const editedResponse = (searchText: string) => ({
      expandedQuery: { original: "深層学習", english: "深層学習", synonyms: [], searchText },
      queryEmbedding: [0.3, 0.2, 0.1],
    });

    const searchOriginal = async () => {
      mockSearchApi.mockResolvedValueOnce({
        expandedQuery: expandedWithSynonyms,
        queryEmbedding: embedding,
      });
      const view = renderHomeSearch();
      act(() => {
        view.result.current.home.setSearchInputValue("深層学習");
      });
      await act(async () => {
        await view.result.current.home.handleSearch("深層学習");
      });
      await waitFor(() => expect(view.result.current.home.completedQuery).toBe("深層学習"));
      return view;
    };

    it("編集した検索文を embeddingText として1回だけ送り、元の入力・URL を保持する", async () => {
      const { result, addHistory } = await searchOriginal();
      mockSearchApi.mockResolvedValueOnce(editedResponse("deep learning neural network"));

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning neural network");
      });

      await waitFor(() =>
        expect(result.current.home.expandedQuery?.searchText).toBe("deep learning neural network")
      );
      expect(mockSearchApi).toHaveBeenCalledTimes(2);
      expect(mockSearchApi.mock.calls[1]?.[0]).toEqual({
        query: "深層学習",
        limit: 20,
        embeddingText: "deep learning neural network",
      });
      // 元の入力は保持する
      expect(result.current.location.search).toBe(`?q=${encodeURIComponent("深層学習")}`);
      expect(result.current.home.searchInputValue).toBe("深層学習");
      expect(result.current.home.completedQuery).toBe("深層学習");
      // 英訳・関連語は表示に残す（関連語を検索文へ戻せるようにする）
      expect(result.current.home.expandedQuery?.english).toBe("deep learning");
      expect(result.current.home.expandedQuery?.synonyms).toEqual(expandedWithSynonyms.synonyms);
      expect(result.current.home.queryEmbedding).toEqual([0.3, 0.2, 0.1]);
      // 履歴は元の入力をキーに、編集後の検索文と Embedding で更新する
      await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(2));
      const saved = addHistory.mock.calls[1]?.[0];
      expect(saved?.originalQuery).toBe("深層学習");
      expect(saved?.expandedQuery.searchText).toBe("deep learning neural network");
      // 編集前の検索文も履歴に残す（「元の検索文に戻す」用）
      expect(saved?.expandedQuery.originalSearchText).toBe(expandedWithSynonyms.searchText);
      expect(saved?.queryEmbedding).toEqual([0.3, 0.2, 0.1]);
    });

    it("編集を重ねても、元の検索文はクエリ拡張が返した最初の文のまま", async () => {
      const { result } = await searchOriginal();
      mockSearchApi
        .mockResolvedValueOnce(editedResponse("deep learning"))
        .mockResolvedValueOnce(editedResponse("deep learning graph"));

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() =>
        expect(result.current.home.expandedQuery?.searchText).toBe("deep learning")
      );
      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning graph");
      });
      await waitFor(() =>
        expect(result.current.home.expandedQuery?.searchText).toBe("deep learning graph")
      );

      expect(result.current.home.expandedQuery?.originalSearchText).toBe(
        expandedWithSynonyms.searchText
      );
    });

    it("編集文での再検索中も、表示用の拡張クエリは編集内容を保つ（エディタを消さない）", async () => {
      const { result } = await searchOriginal();
      const pending = deferred<ReturnType<typeof editedResponse>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(result.current.home.isLoading).toBe(true));

      // 前回の結果（編集前の検索）は保持し、前回の結果として区別する（#71）
      expect(result.current.home.expandedQuery?.searchText).toBe(expandedWithSynonyms.searchText);
      expect(result.current.home.previousResultsQuery).toBe("深層学習");
      expect(result.current.home.displayExpandedQuery?.searchText).toBe("deep learning");
      expect(result.current.home.displayExpandedQuery?.synonyms).toEqual(
        expandedWithSynonyms.synonyms
      );

      await act(async () => {
        pending.resolve(editedResponse("deep learning"));
        await pending.promise;
      });
    });

    it.each([
      ["ネットワークエラー", new TypeError("Failed to fetch")],
      ["429", new Error("Rate limit exceeded")],
      ["500", new Error("OpenAI API key is not configured.")],
      ["API利用OFF", Object.assign(new Error("API利用がOFF"), { name: "ApiDisabledError" })],
    ])("編集文での再検索が失敗（%s）しても、編集内容を表示に残す", async (_label, failure) => {
      const { result, addHistory } = await searchOriginal();
      mockSearchApi.mockRejectedValueOnce(failure);

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(result.current.home.error).not.toBeNull());

      expect(result.current.home.isLoading).toBe(false);
      expect(result.current.home.displayExpandedQuery?.searchText).toBe("deep learning");
      expect(result.current.home.displayExpandedQuery?.originalSearchText).toBe(
        expandedWithSynonyms.searchText
      );
      // 失敗した編集文の検索は履歴に残さない
      expect(addHistory).toHaveBeenCalledTimes(1);
      // 失敗後も同じ編集内容から再試行できる
      mockSearchApi.mockResolvedValueOnce(editedResponse("deep learning"));
      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() =>
        expect(result.current.home.expandedQuery?.searchText).toBe("deep learning")
      );
      expect(mockSearchApi.mock.calls[2]?.[0]).toMatchObject({ embeddingText: "deep learning" });
    });

    /** 編集文での再検索を失敗させ、編集内容だけが表示に残る状態にする */
    const failEditedSearch = async (view: Awaited<ReturnType<typeof searchOriginal>>) => {
      mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));
      act(() => {
        view.result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(view.result.current.home.error).not.toBeNull());
      expect(view.result.current.home.displayExpandedQuery?.searchText).toBe("deep learning");
    };

    it("クリアすると、編集内容の表示を残さない", async () => {
      const view = await searchOriginal();
      await failEditedSearch(view);

      view.clear();

      expect(view.result.current.home.displayExpandedQuery).toBeNull();
    });

    it("履歴から再検索すると、編集内容の表示を残さない", async () => {
      const view = await searchOriginal();
      await failEditedSearch(view);
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      // 保存済み Embedding のない履歴（API で検索し直す）
      act(() => {
        view.result.current.home.handleReSearch({
          id: "00000000-0000-4000-8000-000000000001",
          originalQuery: "B",
          expandedQuery: expanded("B"),
          resultCount: 1,
          createdAt: new Date(),
        });
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(3));

      expect(view.result.current.home.displayExpandedQuery).toBeNull();
      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
      expect(view.result.current.home.displayExpandedQuery?.searchText).toBe("B");
    });

    it("URL の q が外部から変わって検索すると、編集内容の表示を残さない", async () => {
      const view = await searchOriginal();
      await failEditedSearch(view);
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      act(() => {
        view.result.current.filter.setSearchQuery("C");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(3));

      expect(view.result.current.home.displayExpandedQuery).toBeNull();
      await act(async () => {
        pending.resolve(response("C"));
        await pending.promise;
      });
      expect(view.result.current.home.displayExpandedQuery?.searchText).toBe("C");
    });

    it("入力から新しく検索すると、編集内容の表示を残さない", async () => {
      const { result } = await searchOriginal();
      mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));
      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(result.current.home.error).not.toBeNull());

      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);
      act(() => {
        void result.current.home.handleSearch("B");
      });

      expect(result.current.home.displayExpandedQuery).toBeNull();
      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
    });

    it("編集文での再検索中にクリアすると、後から届いた応答を採用しない（#34）", async () => {
      const { result, addHistory, clear } = await searchOriginal();
      const pending = deferred<ReturnType<typeof editedResponse>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));
      clear();

      await act(async () => {
        pending.resolve(editedResponse("deep learning"));
        await pending.promise;
      });

      expect(result.current.home.expandedQuery).toBeNull();
      expect(result.current.location.search).toBe("");
      expect(addHistory).toHaveBeenCalledTimes(1);
    });

    it("編集文での再検索の後に別の検索を始めると、編集文の応答が遅れて届いても新しい検索を維持する（#34）", async () => {
      const { result } = await searchOriginal();
      const editedPending = deferred<ReturnType<typeof editedResponse>>();
      mockSearchApi.mockReturnValueOnce(editedPending.promise).mockResolvedValueOnce(response("B"));

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));
      await act(async () => {
        await result.current.home.handleSearch("B");
      });
      await waitFor(() => expect(result.current.home.completedQuery).toBe("B"));

      await act(async () => {
        editedPending.resolve(editedResponse("deep learning"));
        await editedPending.promise;
      });

      expect(result.current.home.expandedQuery?.searchText).toBe("B");
      expect(result.current.location.search).toBe("?q=B");
      expect(mockSearchApi).toHaveBeenCalledTimes(3);
    });

    it("検索していない状態では何もしない", () => {
      const { result } = renderHomeSearch();

      act(() => {
        result.current.home.handleSearchWithEditedText("deep learning");
      });

      expect(mockSearchApi).not.toHaveBeenCalled();
    });
  });

  describe("保存済み論文の読み込み中の検索（#65）", () => {
    /** 全件（読み込み完了後）の論文。読み込み中の一覧には先頭の1件だけがある */
    const allPapers: Paper[] = [
      papers[0] as Paper,
      { ...(papers[0] as Paper), id: "2401.00002" },
      { ...(papers[0] as Paper), id: "2401.00003" },
    ];

    /** 全件準備の完了をテストから制御できる検索の実行元（索引には全件が入る） */
    const createLoadingSource = () => {
      let ready = false;
      let resolveReady!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = () => {
          ready = true;
          resolve();
        };
      });
      const source: PaperSearchSource = {
        isReady: () => ready,
        whenReady: () => readyPromise,
        search: createTestSearchSource(allPapers).search,
      };
      return { source, resolveReady };
    };

    /** 読み込み中の状態で検索の入口を操作し、完了前後の結果・履歴を確かめる */
    const expectSettledAfterLoad = async (
      view: ReturnType<typeof renderHomeSearch>,
      loading: ReturnType<typeof createLoadingSource>,
      query: string
    ) => {
      await waitFor(() => expect(view.result.current.home.isWaitingForPapers).toBe(true));
      // 読み込み途中の部分集合を確定結果にしない
      expect(view.result.current.home.resultsReady).toBe(false);
      expect(view.result.current.home.results).toEqual([]);
      expect(view.result.current.home.completedQuery).toBeNull();
      expect(view.addHistory).not.toHaveBeenCalled();

      await act(async () => {
        view.rerender({ papers: allPapers });
        loading.resolveReady();
      });

      await waitFor(() => expect(view.result.current.home.completedQuery).toBe(query));
      expect(view.result.current.home.results.map((r) => r.paper.id)).toEqual([
        "2401.00001",
        "2401.00002",
        "2401.00003",
      ]);
      // 履歴には全件に対する件数を1回だけ保存する
      await waitFor(() => expect(view.addHistory).toHaveBeenCalledTimes(1));
      expect(view.addHistory.mock.calls[0]?.[0]).toMatchObject({
        originalQuery: query,
        resultCount: 3,
      });
    };

    it("入力からの検索は全件の準備完了後に確定し、全件の件数で履歴に保存する", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const loading = createLoadingSource();
      const view = renderHomeSearch({
        initialPapers: [allPapers[0] as Paper],
        searchSource: loading.source,
      });

      act(() => {
        void view.result.current.home.handleSearch("transformer");
      });

      await expectSettledAfterLoad(view, loading, "transformer");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("URL からの検索は全件の準備完了後に確定し、全件の件数で履歴に保存する", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      const loading = createLoadingSource();
      const view = renderHomeSearch({
        initialUrl: "/?q=transformer",
        initialPapers: [allPapers[0] as Paper],
        searchSource: loading.source,
      });

      await expectSettledAfterLoad(view, loading, "transformer");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("履歴からの再検索は全件の準備完了後に確定し、全件の件数で履歴を更新する", async () => {
      const loading = createLoadingSource();
      const view = renderHomeSearch({
        initialPapers: [allPapers[0] as Paper],
        searchSource: loading.source,
      });
      const history: SearchHistory = {
        id: "h1",
        originalQuery: "履歴の語",
        expandedQuery: expanded("履歴の語"),
        queryEmbedding: embedding,
        resultCount: 1,
        createdAt: new Date(),
      };

      act(() => {
        view.result.current.home.handleReSearch(history);
      });

      await expectSettledAfterLoad(view, loading, "履歴の語");
      expect(mockSearchApi).not.toHaveBeenCalled();
    });

    it("編集した検索文での再検索も、読み込み中は全件の準備完了まで確定しない", async () => {
      mockSearchApi.mockResolvedValue(response("transformer"));
      let ready = true;
      let gate = Promise.resolve();
      let openGate!: () => void;
      const source: PaperSearchSource = {
        isReady: () => ready,
        whenReady: () => gate,
        search: createTestSearchSource(allPapers).search,
      };
      const view = renderHomeSearch({ initialPapers: allPapers, searchSource: source });
      await act(async () => {
        await view.result.current.home.handleSearch("transformer");
      });
      await waitFor(() => expect(view.addHistory).toHaveBeenCalledTimes(1));

      // 読み込みの再試行中を再現する
      ready = false;
      gate = new Promise<void>((resolve) => {
        openGate = () => {
          ready = true;
          resolve();
        };
      });
      act(() => {
        view.result.current.home.handleSearchWithEditedText("transformer attention");
      });
      await waitFor(() => expect(view.result.current.home.isWaitingForPapers).toBe(true));
      expect(view.result.current.home.resultsReady).toBe(false);
      expect(view.addHistory).toHaveBeenCalledTimes(1);

      await act(async () => {
        openGate();
      });
      await waitFor(() => expect(view.addHistory).toHaveBeenCalledTimes(2));
      expect(view.addHistory.mock.calls[1]?.[0]).toMatchObject({
        originalQuery: "transformer",
        resultCount: 3,
      });
    });
  });

  describe("検索中・失敗時の前回の結果の保持と手動の復旧（#71）", () => {
    /** A を検索して前回の結果がある状態にする */
    const searchA = async () => {
      mockSearchApi.mockResolvedValueOnce(response("A"));
      const view = renderHomeSearch();
      await act(async () => {
        await view.result.current.home.handleSearch("A");
      });
      await waitFor(() => expect(view.result.current.home.completedQuery).toBe("A"));
      expect(view.addHistory).toHaveBeenCalledTimes(1);
      return view;
    };

    it("検索中に論文の更新で件数が変わっても、前回の結果を新しいクエリの履歴として記録しない", async () => {
      const { result, rerender, addHistory } = await searchA();
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      act(() => {
        result.current.home.setSearchInputValue("B");
        void result.current.home.handleSearch("B");
      });
      expect(result.current.home.previousResultsQuery).toBe("A");
      expect(result.current.home.pendingQuery).toBe("B");

      rerender({ papers: [...papers, { ...papers[0], id: "2401.00002" } as Paper] });
      await act(async () => {});
      expect(addHistory).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
      await waitFor(() => expect(result.current.home.completedQuery).toBe("B"));
      expect(addHistory).toHaveBeenCalledTimes(2);
      expect(addHistory.mock.calls[1]?.[0].originalQuery).toBe("B");
    });

    it("失敗しても入力・前回の結果を保持し、自動で再試行しない。再試行は1操作1回", async () => {
      const { result, addHistory } = await searchA();
      mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      act(() => {
        result.current.home.setSearchInputValue("B");
      });
      await act(async () => {
        await result.current.home.handleSearch("B");
      });

      expect(result.current.home.error).not.toBeNull();
      expect(result.current.home.previousResultsQuery).toBe("A");
      expect(result.current.home.pendingQuery).toBe("B");
      expect(result.current.home.completedQuery).toBeNull();
      expect(result.current.home.results).toHaveLength(1);
      expect(result.current.home.searchInputValue).toBe("B");
      expect(result.current.location.search).toBe("?q=B");
      expect(mockSearchApi).toHaveBeenCalledTimes(2);
      expect(addHistory).toHaveBeenCalledTimes(1);

      mockSearchApi.mockResolvedValueOnce(response("B"));
      act(() => {
        result.current.home.handleRetrySearch();
      });

      await waitFor(() => expect(result.current.home.completedQuery).toBe("B"));
      expect(mockSearchApi).toHaveBeenCalledTimes(3);
      expect(mockSearchApi.mock.calls[2]?.[0]).toEqual({ query: "B", limit: 20 });
      expect(result.current.home.previousResultsQuery).toBeNull();
      expect(addHistory).toHaveBeenCalledTimes(2);
    });

    it("編集した検索文での検索が失敗したら、再試行も同じ編集文で送る", async () => {
      const { result } = await searchA();
      mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));
      act(() => {
        result.current.home.handleSearchWithEditedText("A edited");
      });
      await waitFor(() => expect(result.current.home.error).not.toBeNull());

      mockSearchApi.mockResolvedValueOnce(response("A edited"));
      act(() => {
        result.current.home.handleRetrySearch();
      });

      await waitFor(() => expect(result.current.home.error).toBeNull());
      expect(mockSearchApi).toHaveBeenCalledTimes(3);
      expect(mockSearchApi.mock.calls[2]?.[0]).toEqual({
        query: "A",
        limit: 20,
        embeddingText: "A edited",
      });
    });

    it("中止すると URL・完了クエリを前回の結果のクエリに戻し、入力は残す。URL 監視で再検索しない", async () => {
      const { result, addHistory } = await searchA();
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);
      act(() => {
        result.current.home.setSearchInputValue("B");
        void result.current.home.handleSearch("B");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));

      act(() => {
        result.current.home.handleCancelSearch();
      });

      expect(result.current.home.isLoading).toBe(false);
      expect(result.current.home.completedQuery).toBe("A");
      expect(result.current.home.previousResultsQuery).toBeNull();
      expect(result.current.home.pendingQuery).toBeNull();
      expect(result.current.home.searchInputValue).toBe("B");
      await waitFor(() => expect(result.current.location.search).toBe("?q=A"));
      const [, options] = mockSearchApi.mock.calls[1] as [unknown, { signal: AbortSignal }];
      expect(options.signal.aborted).toBe(true);

      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
      expect(result.current.home.expandedQuery?.original).toBe("A");
      expect(result.current.home.completedQuery).toBe("A");
      expect(addHistory).toHaveBeenCalledTimes(1);
      expect(mockSearchApi).toHaveBeenCalledTimes(2);
    });

    it("検索開始と同じ操作の中で中止しても、前回のクエリに戻り、中止した検索をやり直さない", async () => {
      const { result, addHistory } = await searchA();
      const pending = deferred<ReturnType<typeof response>>();
      mockSearchApi.mockReturnValueOnce(pending.promise);

      act(() => {
        result.current.home.setSearchInputValue("B");
        void result.current.home.handleSearch("B");
        // 描画前（検索開始前の値を持つ関数）で中止する
        result.current.home.handleCancelSearch();
      });

      await waitFor(() => expect(result.current.location.search).toBe("?q=A"));
      expect(result.current.home.isLoading).toBe(false);
      expect(result.current.home.completedQuery).toBe("A");
      expect(result.current.home.searchInputValue).toBe("B");
      await act(async () => {
        pending.resolve(response("B"));
        await pending.promise;
      });
      expect(result.current.home.expandedQuery?.original).toBe("A");
      expect(result.current.location.search).toBe("?q=A");
      // キーの取得（await）の間に中止したため B は送信されず、A も再検索されない
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
      expect(addHistory).toHaveBeenCalledTimes(1);
    });

    it("失敗していないとき（検索前・実行中・成功後）の再試行は何もしない", async () => {
      const { result } = await searchA();
      act(() => {
        result.current.home.handleRetrySearch();
      });
      await act(async () => {});
      expect(mockSearchApi).toHaveBeenCalledTimes(1);

      mockSearchApi.mockReturnValueOnce(new Promise(() => {}));
      act(() => {
        void result.current.home.handleSearch("B");
      });
      await waitFor(() => expect(mockSearchApi).toHaveBeenCalledTimes(2));
      act(() => {
        result.current.home.handleRetrySearch();
      });
      await act(async () => {});
      expect(mockSearchApi).toHaveBeenCalledTimes(2);

      const fresh = renderHomeSearch();
      act(() => {
        fresh.result.current.home.handleRetrySearch();
      });
      await act(async () => {});
      expect(mockSearchApi).toHaveBeenCalledTimes(2);
    });

    it("実行中に、表示中の結果と同じ履歴を選び直すと、履歴を更新する（並び順を最新にする）", async () => {
      const history: SearchHistory = {
        id: "h-x",
        originalQuery: "X",
        expandedQuery: expanded("X"),
        queryEmbedding: embedding,
        resultCount: 1,
        createdAt: new Date(),
      };
      const { result, addHistory } = renderHomeSearch();
      act(() => {
        result.current.home.handleReSearch(history);
      });
      await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1));
      mockSearchApi.mockReturnValueOnce(new Promise(() => {}));
      act(() => {
        void result.current.home.handleSearch("B");
      });

      act(() => {
        result.current.home.handleReSearch(history);
      });

      await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(2));
      expect(addHistory.mock.calls[1]?.[0].originalQuery).toBe("X");
      expect(result.current.home.completedQuery).toBe("X");
    });

    describe("失敗した検索は同じ経路で再試行する", () => {
      /** 1回目の全件準備（または計算）だけ失敗する検索の実行元 */
      const createFailOnceSource = (failure: "load" | "compute") => {
        let failed = false;
        const base = createTestSearchSource(papers);
        const source: PaperSearchSource = {
          isReady: () => failed || failure === "compute",
          whenReady: async () => {
            if (failure === "load" && !failed) {
              failed = true;
              throw Object.assign(new Error("db"), { name: "PaperLoadError" });
            }
          },
          search: async (...args) => {
            if (failure === "compute" && !failed) {
              failed = true;
              throw new Error("worker crashed");
            }
            return base.search(...args);
          },
        };
        return source;
      };

      it("履歴（保存済み Embedding）の検索が論文の読み込みで失敗したら、再試行で検索APIを呼ばない", async () => {
        const { result, addHistory } = renderHomeSearch({
          searchSource: createFailOnceSource("load"),
        });
        act(() => {
          result.current.home.handleReSearch({
            id: "h-x",
            originalQuery: "X",
            expandedQuery: expanded("X"),
            queryEmbedding: embedding,
            resultCount: 1,
            createdAt: new Date(),
          });
        });
        await waitFor(() => expect(result.current.home.error?.name).toBe("PaperLoadError"));

        act(() => {
          result.current.home.handleRetrySearch();
        });

        await waitFor(() => expect(result.current.home.completedQuery).toBe("X"));
        expect(result.current.home.error).toBeNull();
        expect(result.current.home.results).toHaveLength(1);
        expect(mockSearchApi).not.toHaveBeenCalled();
        expect(addHistory).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["論文の読み込み", "load", "PaperLoadError"],
        ["索引での計算", "compute", "SearchComputeError"],
      ] as const)("入力の検索が Embedding 取得後に%sで失敗したら、再試行で検索APIを呼び直さない", async (_label, failure, errorName) => {
        mockSearchApi.mockResolvedValueOnce(response("B"));
        const { result } = renderHomeSearch({ searchSource: createFailOnceSource(failure) });
        await act(async () => {
          await result.current.home.handleSearch("B");
        });
        await waitFor(() => expect(result.current.home.error?.name).toBe(errorName));
        expect(mockSearchApi).toHaveBeenCalledTimes(1);

        act(() => {
          result.current.home.handleRetrySearch();
        });

        await waitFor(() => expect(result.current.home.completedQuery).toBe("B"));
        expect(result.current.home.expandedQuery?.original).toBe("B");
        expect(result.current.home.results).toHaveLength(1);
        expect(mockSearchApi).toHaveBeenCalledTimes(1);
      });

      it("中止・前結果を見た検索は再試行しない（前回の結果の再計算の失敗を、表示中の結果の条件で再試行する）", async () => {
        // 確定後の再計算（論文の更新）だけを失敗させられる検索の実行元
        let failCompute = false;
        const base = createTestSearchSource(papers);
        const source: PaperSearchSource = {
          isReady: () => true,
          whenReady: async () => {},
          search: async (...args) => {
            if (failCompute) {
              failCompute = false;
              throw new Error("worker crashed");
            }
            return base.search(...args);
          },
        };
        mockSearchApi.mockResolvedValueOnce(response("A"));
        const { result, rerender, addHistory } = renderHomeSearch({ searchSource: source });
        await act(async () => {
          await result.current.home.handleSearch("A");
        });
        await waitFor(() => expect(result.current.home.completedQuery).toBe("A"));

        // B は検索APIで失敗し、前結果を見る（A に戻る）
        mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));
        await act(async () => {
          await result.current.home.handleSearch("B");
        });
        expect(result.current.home.error).not.toBeNull();
        act(() => {
          result.current.home.handleCancelSearch();
        });
        await waitFor(() => expect(result.current.location.search).toBe("?q=A"));

        // A の再計算が失敗する（新しい検索の失敗ではなく、表示中の A の結果の更新の失敗として扱う。#100）
        failCompute = true;
        rerender({ papers: [...papers] });
        await waitFor(() =>
          expect(result.current.home.recomputeError?.name).toBe("SearchComputeError")
        );
        expect(result.current.home.error).toBeNull();
        expect(result.current.home.previousResultsQuery).toBeNull();

        act(() => {
          result.current.home.handleRetrySearch();
        });

        await waitFor(() => expect(result.current.home.recomputeError).toBeNull());
        expect(result.current.home.completedQuery).toBe("A");
        expect(result.current.home.error).toBeNull();
        expect(result.current.home.expandedQuery?.original).toBe("A");
        expect(result.current.location.search).toBe("?q=A");
        // B を検索APIで呼び直さず、A の履歴を B の内容で上書きしない
        expect(mockSearchApi).toHaveBeenCalledTimes(2);
        for (const [history] of addHistory.mock.calls) {
          expect(history.originalQuery).toBe("A");
          expect(history.expandedQuery.original).toBe("A");
        }
      });

      it("確定した結果の再計算の失敗では、再試行で再計算だけをやり直す（検索API・新しい検索は実行しない。#100）", async () => {
        let failCompute = false;
        const base = createTestSearchSource(papers);
        const searchSpy = vi.fn(async (...args: Parameters<PaperSearchSource["search"]>) => {
          if (failCompute) throw new Error("worker crashed");
          return base.search(...args);
        });
        const source: PaperSearchSource = {
          isReady: () => true,
          whenReady: async () => {},
          search: searchSpy,
        };
        mockSearchApi.mockResolvedValueOnce(response("A"));
        const { result, rerender } = renderHomeSearch({ searchSource: source });
        await act(async () => {
          await result.current.home.handleSearch("A");
        });
        await waitFor(() => expect(result.current.home.completedQuery).toBe("A"));
        expect(searchSpy).toHaveBeenCalledTimes(1);

        failCompute = true;
        rerender({ papers: [...papers] });
        await waitFor(() => expect(result.current.home.recomputeError).not.toBeNull());
        expect(result.current.home.error).toBeNull();
        expect(result.current.home.pendingQuery).toBeNull();
        expect(result.current.home.previousResultsQuery).toBeNull();
        expect(result.current.home.completedQuery).toBe("A");
        expect(searchSpy).toHaveBeenCalledTimes(2);

        failCompute = false;
        act(() => {
          result.current.home.handleRetrySearch();
        });

        await waitFor(() => expect(result.current.home.recomputeError).toBeNull());
        expect(searchSpy).toHaveBeenCalledTimes(3);
        expect(mockSearchApi).toHaveBeenCalledTimes(1);
        expect(result.current.home.isLoading).toBe(false);
        expect(result.current.home.completedQuery).toBe("A");
        expect(result.current.location.search).toBe("?q=A");
      });

      it("クリア後は、クリア前に失敗した検索を再試行しない", async () => {
        mockSearchApi.mockRejectedValueOnce(new Error("Rate limit exceeded"));
        const { result, clear } = renderHomeSearch();
        await act(async () => {
          await result.current.home.handleSearch("B");
        });
        expect(result.current.home.error).not.toBeNull();
        clear();

        act(() => {
          result.current.home.handleRetrySearch();
        });
        await act(async () => {});

        expect(mockSearchApi).toHaveBeenCalledTimes(1);
        expect(result.current.home.isLoading).toBe(false);
      });
    });
  });
});
