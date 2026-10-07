/**
 * @vitest-environment jsdom
 *
 * ホーム（App）で検索の件数の定義を区別して表示する検証（Issue #69）
 * - 候補（しきい値以上・表示上限の前）／上位（表示上限の後）／対象外（Embedding未設定）／「N件の論文」（絞り込み後の表示）を区別する
 * - 表示上限による省略と、カテゴリの絞り込みによる省略を書き分ける
 * - 検索欄の近くに、取得済み論文の実データに基づく検索範囲を出す
 * - 履歴に保存する件数は、内訳の「候補」と同じ値
 * - しきい値の変更・論文の追加・0件でも件数と説明が整合し、件数表示のために検索APIを呼び直さない
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../shared/schemas/index";
import { App } from "./App";
// App が lazy() で読み込むコンポーネントを先に読み込む（初回描画時の動的読み込みを先頭テストの testTimeout に含めない）
import "./components/PaperDetail";
import "./components/SettingsDialog";
import { InteractionProvider } from "./contexts/InteractionContext";
import { usePaperStore } from "./stores/paperStore";
import { useSettingsStore } from "./stores/settingsStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// 論文の追加で再描画できるよう、paperStore は状態だけを持つ zustand ストアに差し替える。
// 検索は全件準備済みとして、その時点のストアの論文を索引で検索する
vi.mock("@/client/stores/paperStore", async () => {
  const { create } = await import("zustand");
  const { createPaperEmbeddingIndex } = await import("./lib/paperIndex/core");
  const store = create(() => ({
    papers: [] as Paper[],
    isLoading: false,
    loadStatus: "ready" as string,
    addPapers: vi.fn(),
  }));
  return {
    usePaperStore: store,
    whenPapersReady: () => Promise.resolve(),
    paperStoreSearchSource: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      search: async (queryEmbedding: number[], scoreThreshold: number, limit: number) => {
        const index = createPaperEmbeddingIndex();
        index.upsert(store.getState().papers);
        return index.search(queryEmbedding, scoreThreshold, limit);
      },
    },
  };
});

vi.mock("@/client/stores/interactionStore", () => ({
  useInteractionStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      toggleLike: vi.fn(),
      toggleBookmark: vi.fn(),
      getLikedPaperIds: () => new Set<string>(),
      getBookmarkedPaperIds: () => new Set<string>(),
    };
    return selector ? selector(state) : state;
  }),
}));

const addHistory = vi.hoisted(() => vi.fn());
vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      histories: [],
      addHistory,
      deleteHistory: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

/** テスト用の論文（embedding が null のものは検索対象外） */
const createPaper = (
  id: string,
  embedding: number[] | null,
  categories: string[] = ["cs.AI"]
): Paper => ({
  id,
  title: `Paper ${id}`,
  abstract: `Abstract of ${id}.`,
  authors: ["Author One"],
  categories,
  publishedAt: new Date("2024-01-15T12:00:00Z"),
  updatedAt: new Date("2024-01-16T12:00:00Z"),
  pdfUrl: `https://arxiv.org/pdf/${id}`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
  ...(embedding ? { embedding } : {}),
});

/**
 * クエリEmbedding [1, 0] に近い順に並ぶ論文（類似度はおよそ 0.999〜0.71 で、1 には届かない。既定しきい値 0.3 以上）。
 * 表示上限（20件）を超える25件と、検索対象外（Embedding未設定）の1件。
 */
const SEARCHABLE = Array.from({ length: 25 }, (_, i) =>
  createPaper(
    `2401.${String(i + 1).padStart(5, "0")}`,
    [1, (i + 1) / 25],
    i < 5 ? ["cs.CL"] : ["cs.AI"]
  )
);
const NO_EMBEDDING = createPaper("2401.99999", null, ["cs.AI"]);

const fetchMock = vi.fn();

/** 検索APIの呼び出し回数 */
const countSearchRequests = (): number =>
  fetchMock.mock.calls.filter(([input]) =>
    String(input instanceof Request ? input.url : input).includes("/api/v1/search")
  ).length;

/**
 * 検索APIの応答を返す fetch を設定する
 * @param withEmbedding false ならクエリEmbeddingなし
 * @param failQuery このクエリの検索は 500 で失敗させる
 */
const mockFetch = ({
  withEmbedding = true,
  failQuery,
}: {
  withEmbedding?: boolean;
  failQuery?: string;
} = {}) => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    let body: unknown = { papers: [], fetchedCount: 0, totalResults: 0, took: 0 };
    if (url.includes("/api/v1/search")) {
      if (failQuery !== undefined && String(init?.body ?? "").includes(failQuery)) {
        return new Response(JSON.stringify({ error: "server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      const { query } = JSON.parse(String(init?.body ?? "{}")) as { query: string };
      body = {
        results: [],
        expandedQuery: { original: query, english: query, synonyms: [], searchText: query },
        ...(withEmbedding ? { queryEmbedding: [1, 0] } : {}),
        took: 1,
      };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
};

/** デスクトップ幅（lg 以上）として描画する */
const useDesktopViewport = () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    ...original(query),
    matches: query === "(min-width: 1024px)",
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/** 一覧の「N件の論文」の N（絞り込み後に一覧へ表示しているカード数） */
const getDisplayedCount = () =>
  screen.getByText("件の論文").querySelector("span")?.textContent ?? "";

const getBreakdown = () => screen.getByTestId("search-result-breakdown");

const search = async (query = "transformer") => {
  const user = userEvent.setup();
  renderApp();
  await user.type(await screen.findByRole("searchbox"), `${query}{Enter}`);
  await screen.findByTestId("search-result-breakdown");
  return user;
};

const setThreshold = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
  const toggle = screen.getByRole("button", { name: /^しきい値/ });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  fireEvent.change(screen.getByRole("slider", { name: "類似度のしきい値" }), {
    target: { value },
  });
};

describe("App: 検索の件数の定義を区別して表示する（#69）", () => {
  beforeEach(() => {
    usePaperStore.setState({
      papers: [...SEARCHABLE, NO_EMBEDDING],
      isLoading: false,
      loadStatus: "ready",
    });
    fetchMock.mockReset();
    addHistory.mockClear();
    mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("検索欄の近くに、取得済み論文の実データに基づく検索範囲（期間・カテゴリ・対象外）を出す", async () => {
    const restore = useDesktopViewport();
    try {
      renderApp();
      expect(await screen.findByTestId("search-scope")).toHaveTextContent(
        "このデバイスに取得済みの論文内を検索: 取得済み 26件（公開日 最古 2024/01/15・最新 2024/01/15・カテゴリ cs.AI・cs.CL）・検索対象 25件・対象外 1件（Embedding未設定）"
      );
    } finally {
      restore();
    }
  });

  it("モバイルでは検索範囲を短縮形にし、期間・カテゴリは開いたときだけ出す", async () => {
    const user = userEvent.setup();
    renderApp();
    const scope = await screen.findByTestId("search-scope");
    const summary = scope.querySelector("summary") as HTMLElement;
    expect(summary).toHaveTextContent(/^取得済み論文内を検索: 取得済み 26件・対象外 1件$/);
    const detail = screen.getByText(/^取得済み 26件（公開日 最古/);
    expect(detail).not.toBeVisible();

    await user.click(summary);
    expect(detail).toBeVisible();
  });

  it("保存済み論文の段階的な読み込み中（全件準備前）は、途中の件数を検索範囲として出さない", async () => {
    usePaperStore.setState({
      loadStatus: "loading",
      loadedCount: 10,
      totalCount: 26,
    } as Partial<ReturnType<typeof usePaperStore.getState>>);
    renderApp();
    await screen.findByRole("searchbox");
    expect(screen.queryByTestId("search-scope")).not.toBeInTheDocument();
  });

  it("候補が表示上限を超えると「候補 X件のうち上位 20件」と出し、履歴には同じ候補の件数を保存する", async () => {
    await search();

    expect(getBreakdown()).toHaveTextContent(
      "候補 25件のうち上位 20件・対象外 1件（Embedding未設定・末尾に表示）"
    );
    // 一覧には上位20件と対象外1件を表示する
    expect(getDisplayedCount()).toBe("21");
    await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1));
    expect(addHistory.mock.calls[0]?.[0]).toMatchObject({ resultCount: 25 });
    expect(countSearchRequests()).toBe(1);
  });

  it("カテゴリの絞り込みは表示上限とは別に「絞り込みで N件を非表示」と出す", async () => {
    const restore = useDesktopViewport();
    try {
      const user = await search();
      // 上位20件のうち cs.CL は5件。cs.CL で絞り込むと上位の残り15件と対象外1件（cs.AI）が外れる
      // デスクトップのカテゴリは折りたたみ領域（#68）。開いてから選ぶ
      await user.click(screen.getByRole("button", { name: /^カテゴリ/ }));
      await user.click(screen.getByRole("button", { name: /^cs\.CL / }));

      expect(getBreakdown()).toHaveTextContent(
        "候補 25件のうち上位 20件・対象外 1件（Embedding未設定・末尾に表示）・絞り込みで 16件を非表示"
      );
      expect(getDisplayedCount()).toBe("5");
      expect(countSearchRequests()).toBe(1);
    } finally {
      restore();
    }
  });

  it("しきい値を変えると候補・上位が再計算され、検索APIも履歴の追加も増えない", async () => {
    const user = await search();
    await waitFor(() => expect(addHistory).toHaveBeenCalledTimes(1));

    // 類似度 = 1 / sqrt(1 + (k/25)^2)（k = 1〜25）。0.9 以上は k <= 12 の12件
    await setThreshold(user, "0.9");
    // 再計算は索引（Web Worker）で非同期に行う
    await waitFor(() =>
      expect(getBreakdown()).toHaveTextContent(
        "候補 12件・対象外 1件（Embedding未設定・末尾に表示）"
      )
    );
    expect(getBreakdown()).not.toHaveTextContent("上位");
    expect(getDisplayedCount()).toBe("13");

    expect(countSearchRequests()).toBe(1);
    expect(addHistory).toHaveBeenCalledTimes(1);
  });

  it("候補が0件でも内訳を出し、空状態の説明と整合する", async () => {
    usePaperStore.setState({ papers: SEARCHABLE });
    const user = await search();

    await setThreshold(user, "1");
    await waitFor(() => expect(getBreakdown()).toHaveTextContent(/^候補 0件$/));
    expect(
      await screen.findByText("類似度がしきい値 1.00 以上の論文はありません")
    ).toBeInTheDocument();
    expect(screen.queryByText("件の論文")).not.toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
  });

  it("論文の追加・Embedding補完に追従して件数が変わり、検索APIを呼び直さない", async () => {
    await search();
    expect(getBreakdown()).toHaveTextContent("候補 25件のうち上位 20件");

    act(() => {
      usePaperStore.setState({
        papers: [
          ...SEARCHABLE,
          // 対象外だった論文に Embedding が付き、新しい論文が1件届く（Embedding未設定）
          { ...NO_EMBEDDING, embedding: [1, 0] },
          createPaper("2401.88888", null),
        ],
      });
    });

    await waitFor(() => expect(getBreakdown()).toHaveTextContent("候補 26件のうち上位 20件"));
    expect(getBreakdown()).toHaveTextContent(
      "候補 26件のうち上位 20件・対象外 1件（Embedding未設定・末尾に表示）"
    );
    expect(screen.getByTestId("search-scope")).toHaveTextContent(
      "取得済み 27件（公開日 最古 2024/01/15・最新 2024/01/15・カテゴリ cs.AI・cs.CL）・検索対象 26件・対象外 1件（Embedding未設定）"
    );
    expect(countSearchRequests()).toBe(1);
  });

  it("クエリEmbeddingがなく類似度を計算していない検索では、内訳（候補 0件）を出さない", async () => {
    mockFetch({ withEmbedding: false });
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
    // 検索は完了している（件数行のしきい値の操作が出る）
    await screen.findByRole("button", { name: /^しきい値/ });

    expect(screen.queryByTestId("search-result-breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText(/候補/)).not.toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
  });

  it("APIキーの復号に失敗した検索では、内訳（候補 0件）を出さない", async () => {
    // 一覧が空のときに復号失敗の理由が出る（対象外の論文は置かない）
    usePaperStore.setState({ papers: SEARCHABLE });
    const decryptError = Object.assign(new Error("decrypt failed"), { name: "OperationError" });
    const originalGetApiKeyAsync = useSettingsStore.getState().getApiKeyAsync;
    useSettingsStore.setState({
      apiKey: "encrypted-key",
      getApiKeyAsync: async () => {
        throw decryptError;
      },
    });
    try {
      const user = userEvent.setup();
      renderApp();
      await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
      expect(await screen.findByText("APIキーの復号に失敗しました")).toBeInTheDocument();

      expect(screen.queryByTestId("search-result-breakdown")).not.toBeInTheDocument();
      expect(screen.queryByText(/候補/)).not.toBeInTheDocument();
      // 復号に失敗したため検索APIは呼ばれない
      expect(countSearchRequests()).toBe(0);
    } finally {
      useSettingsStore.setState({ getApiKeyAsync: originalGetApiKeyAsync });
    }
  });

  it("新しい検索が失敗して前回の結果を表示している間は、内訳を出さない（新しい検索の値と混ぜない）", async () => {
    mockFetch({ failQuery: "broken" });
    const user = await search("transformer");
    expect(getBreakdown()).toHaveTextContent("候補 25件のうち上位 20件");

    const searchbox = screen.getByRole("searchbox");
    await user.clear(searchbox);
    await user.type(searchbox, "broken{Enter}");
    // 前回の結果（transformer）の一覧は残る
    await waitFor(() => expect(countSearchRequests()).toBe(2));
    await waitFor(() =>
      expect(screen.queryByTestId("search-result-breakdown")).not.toBeInTheDocument()
    );
    expect(screen.getByText(`Paper ${SEARCHABLE[0]?.id}`)).toBeInTheDocument();
  });

  it("検索していないときは内訳を出さない", async () => {
    renderApp();
    await screen.findByTestId("search-scope");
    expect(screen.queryByTestId("search-result-breakdown")).not.toBeInTheDocument();
  });
});
