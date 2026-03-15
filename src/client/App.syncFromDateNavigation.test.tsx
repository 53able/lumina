/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const mockSyncFromDate = vi.fn((date: string) => {
  mockSyncUiState.isSyncingFromDate = true;
  mockSyncUiState.syncFromDateTarget = date;
  return new Promise(() => {});
});
const mockStopSync = vi.fn();
const mockSyncUiState = {
  isFetching: false,
  isLoadingMore: false,
  isSyncingAll: false,
  syncAllProgress: null as { fetched: number; total: number } | null,
  isSyncingFromDate: false,
  syncFromDateTarget: null as string | null,
  isEmbeddingBackfilling: false,
  embeddingBackfillProgress: null as { completed: number; total: number } | null,
  lastSyncError: null as Error | null,
};

const mockPapers = Array.from({ length: 10 }, (_, index) => ({
  id: `paper-${index + 1}`,
  title: `Paper ${index + 1}`,
  abstract: "test abstract",
  authors: ["Test Author"],
  categories: ["cs.AI"],
  publishedAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  updatedAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  pdfUrl: `https://arxiv.org/pdf/test-${index + 1}.pdf`,
  arxivUrl: `https://arxiv.org/abs/test-${index + 1}`,
  embedding: [],
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./hooks/useSyncPapers", () => ({
  useSyncPapers: () => ({
    sync: vi.fn(),
    syncMore: vi.fn(),
    syncAll: vi.fn(),
    stopSync: mockStopSync,
    runEmbeddingBackfill: vi.fn(),
    syncFromDate: mockSyncFromDate,
    isSyncing: false,
    isSyncingFromDate: mockSyncUiState.isSyncingFromDate,
    syncFromDateTarget: mockSyncUiState.syncFromDateTarget,
    hasMore: false,
  }),
}));

vi.mock("./stores/paperStore", () => ({
  usePaperStore: vi.fn((selector?: (state: { papers: typeof mockPapers; isLoading: boolean }) => unknown) => {
    const state = {
      papers: mockPapers,
      isLoading: false,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("./stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => ({
      selectedCategories: ["cs.AI"],
      syncPeriodDays: "3",
      autoGenerateSummary: false,
      shouldAutoSync: () => false,
      searchScoreThreshold: 0.5,
      getLastSyncedAt: () => null,
    })),
    {
      getState: () => ({
        runSyncPeriodResetMigration: () => false,
      }),
      persist: {
        onFinishHydration: () => () => {},
        hasHydrated: () => true,
      },
    }
  ),
}));

vi.mock("./stores/syncStore", () => ({
  useSyncStore: vi.fn((selector: (s: typeof mockSyncUiState) => unknown) => {
    return selector ? selector(mockSyncUiState) : mockSyncUiState;
  }),
}));

vi.mock("./hooks/useSemanticSearch", () => ({
  useSemanticSearch: () => ({
    search: vi.fn(async () => []),
    searchWithSavedData: vi.fn(),
    results: [],
    papersExcludedFromSearch: [],
    isLoading: false,
    expandedQuery: null,
    queryEmbedding: null,
    error: null,
    reset: vi.fn(),
    totalMatchCount: 0,
  }),
}));

vi.mock("./hooks/usePaperSummary", () => ({
  usePaperSummary: () => ({
    summary: undefined,
    summaryLanguage: "ja",
    setSummaryLanguage: vi.fn(),
    isLoading: false,
    generateSummary: vi.fn(),
  }),
}));

vi.mock("./hooks/useSearchFromUrl", () => ({
  useSearchFromUrl: vi.fn(),
}));

vi.mock("./hooks/useSearchHistorySync", () => ({
  useSearchHistorySync: vi.fn(),
}));

vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

vi.mock("./stores/summaryStore", () => ({
  useSummaryStore: () => ({
    summaries: [],
    getSummaryByPaperIdAndLanguage: vi.fn(),
  }),
}));

vi.mock("./stores/searchHistoryStore", () => ({
  useSearchHistoryStore: () => ({
    addHistory: vi.fn(),
    getRecentHistories: () => [],
    deleteHistory: vi.fn(),
  }),
}));

vi.mock("./components/PaperExplorer", () => ({
  PaperExplorer: ({ initialPapers }: { initialPapers: unknown[] }) => (
    <div data-testid="paper-explorer">{initialPapers.length}</div>
  ),
}));

vi.mock("./components/SearchHistory", () => ({
  SearchHistory: () => <div data-testid="search-history" />,
}));

vi.mock("./components/HomeFooter", () => ({
  HomeFooter: () => <footer>Footer</footer>,
}));

vi.mock("./pages/PaperPage", () => ({
  PaperPage: () => <div>Paper Page</div>,
}));

vi.mock("./components/PaperCacheBarChart", () => ({
  PaperCacheBarChart: () => <div data-testid="paper-cache-bar-chart" />,
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

const renderWithProviders = (ui: ReactNode) => {
  const testQueryClient = createTestQueryClient();
  return render(
    <MemoryRouter initialEntries={["/stats"]}>
      <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
};

describe("App syncFromDate navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncUiState.isFetching = false;
    mockSyncUiState.isLoadingMore = false;
    mockSyncUiState.isSyncingAll = false;
    mockSyncUiState.syncAllProgress = null;
    mockSyncUiState.isSyncingFromDate = false;
    mockSyncUiState.syncFromDateTarget = null;
    mockSyncUiState.isEmbeddingBackfilling = false;
    mockSyncUiState.embeddingBackfillProgress = null;
    mockSyncUiState.lastSyncError = null;
  });

  it("stats で開始した syncFromDate をホーム一覧で停止できる", async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

    await user.click(await screen.findByRole("button", { name: "2026-01-01から同期する" }));
    expect(mockSyncFromDate).toHaveBeenCalledWith("2026-01-01");

    await user.click(await screen.findByRole("link", { name: "論文一覧へ戻る" }));

    expect(await screen.findByText("2026-01-01以前の論文を取得中...")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "同期を停止" }));

    expect(mockStopSync).toHaveBeenCalledTimes(1);
  });
});
