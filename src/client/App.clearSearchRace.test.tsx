/**
 * @vitest-environment jsdom
 *
 * 検索のクリアと store 更新が同時に起きても、URL 起点の検索をやり直さないことの検証（Issue #81）
 *
 * react-router は URL 更新を startTransition で包むため、クリア直後は「URL の q は残ったまま、
 * 開始済みクエリの記録は消えた」状態が一時的に生じる。この間に検索関数の参照が変わる store 更新
 * （histories / scoreThreshold）が起きても検索 API を呼ばないことを、本物の zustand store で確かめる。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHistory } from "../shared/schemas/index";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

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

vi.mock("@/client/stores/paperStore", () => ({
  usePaperStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => {
      const state = { papers: mockPapers, isLoading: false, addPapers: vi.fn() };
      return selector ? selector(state) : state;
    }),
    { getState: () => ({ papers: mockPapers }) }
  ),
}));

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
    useSearchHistoryStore.setState({ histories: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: "histories",
      update: () => useSearchHistoryStore.setState({ histories: [otherHistory] }),
    },
    {
      name: "scoreThreshold",
      update: () => useSettingsStore.getState().setSearchScoreThreshold(0.5),
    },
  ])("クリアと同時に $name が更新されても、検索 API を呼び直さない", async ({ update }) => {
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
    await waitFor(() => expect(screen.getByRole("searchbox")).toBeDisabled());
    expect(searchRequestCount()).toBe(1);

    // クリアの click と同じタイミングで store を更新する（URL 更新の transition より先に確定する）
    const clearButton = screen.getByRole("button", { name: "検索と絞り込みをクリア" });
    act(() => {
      clearButton.click();
      update();
    });

    await waitFor(() => expect(screen.getByTestId("location-search")).toHaveTextContent(""));
    expect(searchRequestCount()).toBe(1);
    const searchbox = screen.getByRole("searchbox");
    await waitFor(() => expect(searchbox).toBeEnabled());
    expect(searchbox).toHaveValue("");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    expect(searchRequestCount()).toBe(1);
  });
});
