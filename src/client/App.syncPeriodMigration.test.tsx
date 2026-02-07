/**
 * @vitest-environment jsdom
 *
 * 同期期間リセットマイグレーション実行時のトースト通知を検証する。
 * settingsStore と sonner をモックし、onFinishHydration 発火時にトーストが表示されることを確認する。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";

vi.stubGlobal("fetch", vi.fn());

const mockRunSyncPeriodResetMigration = vi.fn<[], boolean>();
let hydrationCallback: (() => void) | null = null;

vi.mock("@/client/stores/settingsStore", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/client/stores/settingsStore")>();
  const realStore = orig.useSettingsStore;
  const getState = () => ({
    ...realStore.getState(),
    runSyncPeriodResetMigration: mockRunSyncPeriodResetMigration,
  });
  return {
    useSettingsStore: Object.assign(
      (selector?: (s: ReturnType<typeof getState>) => unknown) => {
        const state = getState();
        return selector ? selector(state) : state;
      },
      {
        getState,
        persist: {
          onFinishHydration: (cb: () => void) => {
            hydrationCallback = cb;
            return () => {
              hydrationCallback = null;
            };
          },
        },
      }
    ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("@/client/stores/interactionStore", () => ({
  useInteractionStore: () => ({
    toggleLike: vi.fn(),
    toggleBookmark: vi.fn(),
    getLikedPaperIds: () => new Set<string>(),
    getBookmarkedPaperIds: () => new Set<string>(),
  }),
}));

vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: () => ({
    histories: [],
    getRecentHistories: () => [],
    deleteHistory: vi.fn(),
  }),
}));

vi.mock("@/client/stores/paperStore", () => ({
  usePaperStore: () => ({
    papers: [],
    addPapers: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/client/hooks/usePaperFilter", () => ({
  usePaperFilter: () => ({
    searchQuery: null as string | null,
    setSearchQuery: vi.fn(),
    filterMode: "all" as const,
    selectedCategories: new Set<string>(),
    toggleFilterMode: vi.fn(),
    toggleCategory: vi.fn(),
    clearAllFilters: vi.fn(),
    filterPapers: (papers: unknown[]) => papers,
  }),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: ReactNode) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={createTestQueryClient()}>
        <InteractionProvider>{ui}</InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("App syncPeriodMigration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    hydrationCallback = null;
  });

  beforeEach(() => {
    mockRunSyncPeriodResetMigration.mockReturnValue(true);
  });

  it("onFinishHydration 後にマイグレーションが実行されたらトーストで通知する", () => {
    renderWithProviders(<App />);

    expect(hydrationCallback).not.toBeNull();
    hydrationCallback?.();

    expect(mockRunSyncPeriodResetMigration).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "同期期間を1日に統一しました。必要に応じて設定で変更できます。"
    );
  });

  it("マイグレーションが実施済みの場合はトーストを表示しない", () => {
    mockRunSyncPeriodResetMigration.mockReturnValue(false);

    renderWithProviders(<App />);
    hydrationCallback?.();

    expect(mockRunSyncPeriodResetMigration).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
