/**
 * @vitest-environment jsdom
 *
 * 保存済み論文の読み込み中・失敗時の同期の保護（#65）
 * 読み込み途中の部分集合を既存論文とみなして自動同期・追加同期しないことを検証する。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { HomeMain } from "./components/HomeMain";
import { InteractionProvider } from "./contexts/InteractionContext";
import { PaperLoadError } from "./lib/paperIndex/client";
import { usePaperStore } from "./stores/paperStore";
import { useSettingsStore } from "./stores/settingsStore";
import { resetPaperStoreForTest } from "./testing/paperStoreTestUtils";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockSync = vi.fn();
const mockSyncMore = vi.fn(async () => {});
vi.mock("./hooks/useSyncPapers", () => ({
  useSyncPapers: () => ({
    sync: mockSync,
    retrySync: vi.fn(),
    syncMore: mockSyncMore,
    syncAll: vi.fn(),
    stopSync: vi.fn(),
    runEmbeddingBackfill: vi.fn(),
    isSyncing: false,
    isSyncingFromDate: false,
    hasMore: true,
  }),
}));

/** App から HomeMain へ渡された props（同期の配線の検証用） */
let homeMainProps: ComponentProps<typeof HomeMain> | null = null;
vi.mock("./components/HomeMain", () => ({
  HomeMain: (props: ComponentProps<typeof HomeMain>) => {
    homeMainProps = props;
    return null;
  },
}));

const storedPaper = {
  id: "2401.00001",
  title: "Stored Paper",
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  hasEmbedding: true,
};

const renderApp = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

describe("App: 保存済み論文の読み込み中の同期（#65）", () => {
  beforeEach(() => {
    homeMainProps = null;
    // 最終同期なし（読み込みが終われば自動同期の対象）
    useSettingsStore.setState({ lastSyncedAt: null });
  });

  afterEach(() => {
    cleanup();
    resetPaperStoreForTest();
    vi.clearAllMocks();
  });

  it("読み込み中は0件でも自動同期せず、追加同期も渡さない。全件の準備完了後に1回だけ自動同期する", () => {
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true });
    renderApp();

    expect(mockSync).not.toHaveBeenCalled();
    expect(homeMainProps?.onRequestSync).toBeUndefined();
    // 読み込み中の0件を「これから同期する」とも扱わない（一覧は読み込み中として表示する）
    expect(homeMainProps?.isSyncPending).toBe(false);

    act(() => {
      usePaperStore.setState({ papers: [storedPaper], loadStatus: "ready", isLoading: false });
    });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(homeMainProps?.onRequestSync).toBe(mockSyncMore);
  });

  it("先頭バッチが届いても全件の準備完了までは自動同期しない", () => {
    usePaperStore.setState({ papers: [], loadStatus: "loading", isLoading: true });
    renderApp();

    act(() => {
      usePaperStore.setState({ papers: [storedPaper], loadedCount: 1, totalCount: 55531 });
    });

    expect(mockSync).not.toHaveBeenCalled();
    expect(homeMainProps?.onRequestSync).toBeUndefined();
  });

  it("読み込みに失敗したら自動同期・追加同期をしない（0件扱いで全件を取り直さない）", () => {
    usePaperStore.setState({
      papers: [],
      loadStatus: "error",
      isLoading: false,
      loadError: new PaperLoadError("保存済みの論文を読み込めませんでした: IndexedDB が開けません"),
    });
    renderApp();

    expect(mockSync).not.toHaveBeenCalled();
    expect(homeMainProps?.onRequestSync).toBeUndefined();
    expect(homeMainProps?.isSyncPending).toBe(false);
  });

  it("全件の準備完了で0件なら自動同期する", () => {
    usePaperStore.setState({ papers: [], loadStatus: "ready", isLoading: false });
    renderApp();

    expect(mockSync).toHaveBeenCalledTimes(1);
  });
});
