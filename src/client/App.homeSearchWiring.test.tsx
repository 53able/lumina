/**
 * @vitest-environment jsdom
 *
 * App → HomeMain → PaperExplorer の検索系 props の受け渡しの検証（Issue #60）
 * 本物の App を描画し、HomeMain が onClear / isSearchLoading / onSearchInputChange（searchInputValue）/
 * externalQuery を PaperExplorer に渡していることを、画面の挙動で確かめる。
 * どれか1つでも渡し忘れると、このファイルのいずれかのテストが失敗する。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// デスクトップのレイアウト（一覧上部に同期ステータス、詳細はインライン展開）で検証する
vi.mock("@/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

const mockPapers = vi.hoisted(() => [
  {
    id: "2401.00001",
    title: "Test Paper Title",
    abstract: "This is a test abstract for the paper.",
    authors: ["Author One"],
    categories: ["cs.AI"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding: [0.1, 0.2],
  },
]);

vi.mock("@/client/stores/paperStore", async () => {
  const { createPaperEmbeddingIndex } = await import("./lib/paperIndex/core");
  return {
    usePaperStore: Object.assign(
      vi.fn((selector?: (s: unknown) => unknown) => {
        const state = {
          papers: mockPapers,
          isLoading: false,
          loadStatus: "ready",
          addPapers: vi.fn(),
        };
        return selector ? selector(state) : state;
      }),
      { getState: () => ({ papers: mockPapers, loadStatus: "ready" }) }
    ),
    whenPapersReady: () => Promise.resolve(),
    // 保存済み論文は全件準備済みとして、mockPapers を索引で検索する
    paperStoreSearchSource: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      search: async (queryEmbedding: number[], scoreThreshold: number, limit: number) => {
        const index = createPaperEmbeddingIndex();
        index.upsert(mockPapers);
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

// 本物の store と同じく、render ごとに同じ参照を返す（histories が毎回変わると findSavedHistory が変わり、
// URL 起点の検索の effect が render のたびに再実行されて、クリア直後に検索がやり直される）
const searchHistoryState = vi.hoisted(() => ({
  histories: [],
  getRecentHistories: () => [],
  addHistory: async () => {},
  deleteHistory: async () => {},
}));
vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) =>
    selector ? selector(searchHistoryState) : searchHistoryState
  ),
}));

const fetchMock = vi.fn();

/** /api/v1/search の応答（論文と同じ Embedding なので保存済み論文が検索結果になる） */
const searchResponse = () =>
  new Response(
    JSON.stringify({
      results: [],
      expandedQuery: {
        original: "transformer",
        english: "transformer",
        synonyms: [],
        searchText: "transformer",
      },
      queryEmbedding: [0.1, 0.2],
      took: 1,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

/** 同期 API など、検索以外の応答 */
const emptySyncResponse = () =>
  new Response(JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

/** 検索 API が応答しない状態にする */
const holdSearchRequests = () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    requestUrl(input).includes("/api/v1/search")
      ? new Promise<Response>(() => {})
      : Promise.resolve(emptySyncResponse())
  );
};

/** 現在の location.search を表示する */
const LocationSearch = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderApp = (initialEntry = "/") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
          <LocationSearch />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

const getLocationSearch = () => screen.getByTestId("location-search").textContent;

describe("App: HomeMain → PaperExplorer の検索 props の受け渡し（#60）", () => {
  beforeAll(() => {
    // jsdom は Element#scrollTo を実装していない（クリア時に呼ばれる）
    Element.prototype.scrollTo ??= () => {};
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      requestUrl(input).includes("/api/v1/search") ? searchResponse() : emptySyncResponse()
    );
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    // 自動同期を走らせない
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("?q= で開くと、App の検索入力値が検索欄に反映される（searchInputValue / onSearchInputChange）", async () => {
    holdSearchRequests();
    renderApp("/?q=transformer");

    // useHomeSearch が URL のクエリを入力値に反映する。PaperSearch が非制御だと空のまま
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("transformer"));
  });

  it("検索中は検索欄と検索ボタンが無効になり、一覧はローディング表示になる（isSearchLoading）", async () => {
    holdSearchRequests();
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("searchbox")).toHaveAttribute("aria-disabled", "true")
    );
    expect(screen.getByRole("button", { name: "検索" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
  });

  it("検索中にクリアすると App の検索状態も解除され、空の検索欄に入力できる（onClear）", async () => {
    holdSearchRequests();
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("searchbox")).toHaveAttribute("aria-disabled", "true")
    );
    expect(getLocationSearch()).toBe("?q=transformer");

    await user.click(screen.getByRole("button", { name: "検索と絞り込みをクリア" }));

    // App 側の handleClearSearch が呼ばれないと、検索中のまま入力欄が無効で値も残る
    const searchbox = screen.getByRole("searchbox");
    await waitFor(() => expect(searchbox).not.toHaveAttribute("aria-disabled"));
    expect(searchbox).toHaveValue("");
    expect(getLocationSearch()).toBe("");
    expect(screen.queryByTestId("paper-list-loading")).not.toBeInTheDocument();

    await user.type(searchbox, "bert");
    expect(searchbox).toHaveValue("bert");
  });

  it("?q= で開いた検索が完了すると、App の検索結果が一覧に表示される（externalQuery）", async () => {
    renderApp("/?q=transformer");

    // URL 起点の検索は PaperExplorer の onSearch を経由しないため、externalQuery が一致したときだけ
    // 親の displayPapers（検索結果）を表示する。渡し忘れると検索結果が0件のままになる
    await waitFor(() => expect(screen.getByText(/件の論文/)).toHaveTextContent("1件の論文"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent('"transformer" の検索結果');
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
  });
});
