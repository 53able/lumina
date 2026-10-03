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
}: {
  initialUrl?: string;
  initialPapers?: Paper[];
  savedHistories?: SearchHistory[];
} = {}) => {
  const findSavedHistory = (query: string) => savedHistories.find((h) => h.originalQuery === query);
  const addHistory = vi.fn(async (_history: SearchHistory) => {});
  const wrapper = ({ children }: { children: ReactNode }) => {
    return <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>;
  };
  const view = renderHook(
    ({ papers: currentPapers }: { papers: Paper[] }) => ({
      home: useHomeSearch({ papers: currentPapers, addHistory, findSavedHistory }),
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
      rerender({ papers: [...papers, { ...pendingPaper, embedding }, addedPaper] });

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

      await waitFor(() => expect(result.current.home.expandedQuery?.original).toBe("履歴の語"));
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

      expect(result.current.home.expandedQuery).toBeNull();
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
});
