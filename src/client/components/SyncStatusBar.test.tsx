/**
 * @vitest-environment jsdom
 *
 * Design Doc: tmp/mobile-embedding-as-is-analysis.md
 * 期待動作: モバイル表示（compact=true）のときも「Embeddingを補完」ボタンが表示され、押下でバックフィルが実行可能であること。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// SyncStatusBar が依存するストア・フックをモック（スタブのみ。実装ロジックは書かない）
const mockPapersWithEmbeddingMissing = [
  {
    id: "2401.00001",
    title: "Test",
    abstract: "Abstract",
    authors: [],
    categories: [],
    publishedAt: new Date(),
    updatedAt: new Date(),
    pdfUrl: "",
    arxivUrl: "",
    // embedding なし → papersWithoutEmbeddingCount > 0
  },
];

vi.mock("../stores/paperStore", () => ({
  usePaperStore: vi.fn((selector: (s: { papers: unknown[] }) => unknown) => {
    const state = {
      papers: mockPapersWithEmbeddingMissing,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: vi.fn(() => ({
    getLastSyncedAt: () => new Date("2026-02-01T15:48:00"),
  })),
}));

const mockSyncStoreState = {
  isFetching: false,
  isLoadingMore: false,
  isSyncingAll: false,
  syncAllProgress: null,
  isSyncingFromDate: false,
  syncFromDateTarget: null as string | null,
  isEmbeddingBackfilling: false,
  embeddingBackfillProgress: null,
  lastSyncError: null,
};

vi.mock("../stores/syncStore", () => ({
  useSyncStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    return selector ? selector(mockSyncStoreState) : mockSyncStoreState;
  }),
}));

describe("SyncStatusBar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockSyncStoreState.isFetching = false;
    mockSyncStoreState.isLoadingMore = false;
    mockSyncStoreState.isSyncingAll = false;
    mockSyncStoreState.syncAllProgress = null;
    mockSyncStoreState.isSyncingFromDate = false;
    mockSyncStoreState.syncFromDateTarget = null;
    mockSyncStoreState.isEmbeddingBackfilling = false;
    mockSyncStoreState.embeddingBackfillProgress = null;
    mockSyncStoreState.lastSyncError = null;
  });

  describe("Embeddingを補完ボタン（Design Doc: スマホでもembedding取得可能）", () => {
    it("compact=true（モバイル表示）のとき、onRunEmbeddingBackfill が渡され embedding 未設定が1件以上あり取得中でない場合、「Embeddingを補完」ボタンが表示される", async () => {
      const { SyncStatusBar } = await import("./SyncStatusBar");
      const onRunEmbeddingBackfill = vi.fn();

      render(<SyncStatusBar compact onRunEmbeddingBackfill={onRunEmbeddingBackfill} />);

      const button = screen.getByRole("button", {
        name: /Embedding未設定の論文を補完|Embeddingを補完/i,
      });
      expect(button).toBeInTheDocument();
    });

    it("compact=true のときボタンをクリックすると onRunEmbeddingBackfill が呼ばれる", async () => {
      const { SyncStatusBar } = await import("./SyncStatusBar");
      const user = userEvent.setup();
      const onRunEmbeddingBackfill = vi.fn();

      render(<SyncStatusBar compact onRunEmbeddingBackfill={onRunEmbeddingBackfill} />);

      const button = screen.getByRole("button", {
        name: /Embedding未設定の論文を補完|Embeddingを補完/i,
      });
      await user.click(button);

      expect(onRunEmbeddingBackfill).toHaveBeenCalledTimes(1);
    });
  });

  describe("syncFromDate の停止導線", () => {
    it("hasMore=false かつ onSyncAll 未指定でも、syncFromDate 実行中は停止ボタンと状態文言を表示する", async () => {
      const { SyncStatusBar } = await import("./SyncStatusBar");
      mockSyncStoreState.isSyncingFromDate = true;
      mockSyncStoreState.syncFromDateTarget = "2026-01-10";

      render(<SyncStatusBar onStopSync={vi.fn()} />);

      expect(screen.getByText("2026-01-10以前の論文を取得中...")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "同期を停止" })).toBeInTheDocument();
    });

    it("停止ボタンを押すと onStopSync が呼ばれる", async () => {
      const { SyncStatusBar } = await import("./SyncStatusBar");
      const user = userEvent.setup();
      const onStopSync = vi.fn();
      mockSyncStoreState.isSyncingFromDate = true;
      mockSyncStoreState.syncFromDateTarget = "2026-01-10";

      render(<SyncStatusBar compact onStopSync={onStopSync} />);

      await user.click(screen.getByRole("button", { name: "同期を停止" }));

      expect(onStopSync).toHaveBeenCalledTimes(1);
    });
  });
});
