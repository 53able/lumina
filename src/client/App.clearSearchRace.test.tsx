/**
 * @vitest-environment jsdom
 *
 * 検索のクリアと store 更新が同時に起きても、URL 起点の検索をやり直さないことの検証（Issue #81）
 *
 * react-router は URL 更新を startTransition で包むため、クリア直後は「URL の q は残ったまま、
 * 開始済みクエリの記録は消えた」状態が一時的に生じる。この間に検索関数の参照が変わる store 更新
 * （papers / histories / scoreThreshold）が起きても検索 API を呼ばないことを、本物の zustand store で確かめる。
 * 別クエリでの検索開始直後（URL 更新の transition が未確定の間）も同様に確かめる。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper, SearchHistory } from "../shared/schemas/index";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { getDecryptedApiKey } from "./lib/api";
import { usePaperStore } from "./stores/paperStore";
import { useSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { resetPaperStoreForTest, seedPaperStoreForTest } from "./testing/paperStoreTestUtils";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// 検索の開始回数を数える（検索は開始直後に API キーを取得する。無効化された検索は API 呼び出し前に止まる）
vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
  return { ...actual, getDecryptedApiKey: vi.fn(actual.getDecryptedApiKey) };
});

vi.mock("@/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

const mockPapers: Paper[] = [
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
];

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

const fetchMock = vi.fn();

const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

const isSearchRequest = (input: RequestInfo | URL) => requestUrl(input).includes("/api/v1/search");

/** 検索 API は応答せず、それ以外（同期 API など）は空の応答を返す */
const holdSearchRequests = () => {
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    isSearchRequest(input)
      ? new Promise<Response>(() => {})
      : Promise.resolve(
          new Response(JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 0 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
  );
};

/** /api/v1/search の応答（検索 API が返す最小限の形） */
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

/** 検索 API に送ったクエリ（呼び出し順） */
const searchQueries = () =>
  fetchMock.mock.calls
    .filter(([input]) => isSearchRequest(input))
    .map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { query: string }).query);

const searchRequestCount = () =>
  fetchMock.mock.calls.filter(([input]) => isSearchRequest(input)).length;

/** 現在の location.search を表示する */
const LocationSearch = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
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

/** クリアと同時に差し込む、検索中のクエリとは別の履歴 */
const otherHistory: SearchHistory = {
  id: "history-other",
  originalQuery: "bert",
  expandedQuery: { original: "bert", english: "bert", synonyms: [], searchText: "bert" },
  resultCount: 0,
  createdAt: new Date("2024-01-01"),
};

describe("App: 検索のクリアと store 更新の競合（#81）", () => {
  beforeAll(() => {
    // jsdom は Element#scrollTo を実装していない（クリア時に呼ばれる）
    Element.prototype.scrollTo ??= () => {};
  });

  beforeEach(() => {
    fetchMock.mockReset();
    holdSearchRequests();
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    // 自動同期を走らせない
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
    // 保存済み論文は全件準備済みにする（読み込み中は自動同期・検索の確定を待つため）
    seedPaperStoreForTest(mockPapers);
    // DB を初期化していないため、検索完了時の履歴追加は何もしない関数に置き換える
    useSearchHistoryStore.setState({ histories: [], addHistory: async () => {} });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetPaperStoreForTest();
  });

  const storeUpdates = [
    {
      name: "papers",
      update: () => usePaperStore.setState({ papers: [...mockPapers] }),
    },
    {
      name: "histories",
      update: () => useSearchHistoryStore.setState({ histories: [otherHistory] }),
    },
    {
      name: "scoreThreshold",
      update: () => useSettingsStore.getState().setSearchScoreThreshold(0.5),
    },
  ];

  it.each(storeUpdates)("クリアと同時に $name が更新されても、検索 API を呼び直さない", async ({
    update,
  }) => {
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("searchbox")).toHaveAttribute("aria-disabled", "true")
    );
    expect(searchRequestCount()).toBe(1);

    // クリアの click と同じタイミングで store を更新する（URL 更新の transition より先に確定する）
    const clearButton = screen.getByRole("button", { name: "検索と絞り込みをクリア" });
    act(() => {
      clearButton.click();
      update();
    });

    await waitFor(() => expect(screen.getByTestId("location-search")).toBeEmptyDOMElement());
    expect(searchRequestCount()).toBe(1);
    const searchbox = screen.getByRole("searchbox");
    // クリア前は検索中（aria-disabled="true"）だったものが解除される
    await waitFor(() => expect(searchbox).not.toHaveAttribute("aria-disabled"));
    expect(searchbox).toHaveValue("");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    expect(searchRequestCount()).toBe(1);
  });

  it.each(
    storeUpdates
  )("別クエリで検索を始めると同時に $name が更新されても、前の URL のクエリで検索し直さない", async ({
    update,
  }) => {
    // 1回目（transformer）は respondFirst で応答し、2回目以降は応答しない
    const holdingImplementation = fetchMock.getMockImplementation();
    let respondFirst: (() => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      isSearchRequest(input) && searchRequestCount() === 1
        ? new Promise<Response>((resolve) => {
            respondFirst = () => resolve(searchResponse());
          })
        : holdingImplementation?.(input, init)
    );
    const user = userEvent.setup();
    renderApp();

    const searchbox = await screen.findByRole("searchbox");
    await user.type(searchbox, "transformer{Enter}");
    // 検索中になったことを確かめてから応答させ、完了（aria-disabled の解除）を待つ
    await waitFor(() => expect(searchRequestCount()).toBe(1));
    expect(searchbox).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      respondFirst?.();
    });
    await waitFor(() => expect(searchbox).not.toHaveAttribute("aria-disabled"));
    expect(screen.getByTestId("location-search")).toHaveTextContent("?q=transformer");

    await user.clear(searchbox);
    await user.type(searchbox, "bert");
    const searchButton = screen.getByRole("button", { name: "検索" });
    const startedBefore = vi.mocked(getDecryptedApiKey).mock.calls.length;
    act(() => {
      searchButton.click();
      update();
    });

    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent("?q=bert"));
    // URL 確定前に前のクエリ（transformer）で検索し直すと、bert → transformer → bert と3回開始される
    expect(vi.mocked(getDecryptedApiKey).mock.calls.length - startedBefore).toBe(1);
    expect(searchQueries()).toEqual(["transformer", "bert"]);
    expect(searchbox).toHaveValue("bert");
  });
});
