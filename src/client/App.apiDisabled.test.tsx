/**
 * @vitest-environment jsdom
 *
 * ホーム（App）での API利用OFF の検証（Issue #29）
 * - 詳細パネルで未要約論文を開いても自動要約の summary リクエストが発生しない
 * - AI検索（入力・URL の ?q= 直開き）は検索 API を呼ばず、保存済み論文の一覧を残したまま停止理由を通知する
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";
import { useSummaryStore } from "./stores/summaryStore";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
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

vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      histories: [],
      getRecentHistories: () => [],
      addHistory: vi.fn(),
      deleteHistory: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

const fetchMock = vi.fn();

/** fetch に渡された URL のうち、指定パスを含むものの件数 */
const countRequests = (path: string): number =>
  fetchMock.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes(path);
  }).length;

const renderApp = (initialEntry = "/") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/** 未要約論文を詳細パネルで開く */
const openPaperDetail = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByText("Test Paper Title"));
  await screen.findAllByText("This is a test abstract for the paper.");
};

describe("App: API利用OFF", () => {
  beforeEach(() => {
    toastError.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = url.includes("/api/v1/summary/")
        ? {
            paperId: "2401.00001",
            summary: "要約",
            keyPoints: [],
            language: "ja",
            createdAt: "2024-01-01T00:00:00.000Z",
          }
        : { papers: [], fetchedCount: 0, totalResults: 0, took: 0 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    // 自動同期を走らせない
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString() });
    useSummaryStore.setState({ summaries: [], addSummary: vi.fn(async () => {}) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("前提: 自動要約ON・API利用ONなら詳細パネルで未要約論文を開くと summary リクエストが発生する", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: true });
    renderApp();

    await openPaperDetail();

    await waitFor(() => expect(countRequests("/api/v1/summary/")).toBe(1));
  });

  it("自動要約ONのままAPI利用をOFFにすると、詳細パネルで未要約論文を開いても summary リクエスト0件・エラー通知なし", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: false });
    renderApp();

    await openPaperDetail();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(countRequests("/api/v1/summary/")).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("OFF中に検索しても検索APIを呼ばず、保存済み論文の一覧を残して停止理由を通知する", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "AI検索を停止中",
        expect.objectContaining({ description: expect.stringContaining("API利用がOFF") })
      )
    );
    expect(countRequests("/api/v1/search")).toBe(0);
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
  });

  it("OFF中に ?q= で直接開いても検索APIを呼ばず、保存済み論文の一覧を残して停止理由を通知する", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    renderApp("/?q=transformer");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("AI検索を停止中", expect.anything())
    );
    expect(countRequests("/api/v1/search")).toBe(0);
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
  });
});
