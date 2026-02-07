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

vi.mock("../stores/syncStore", () => ({
  useSyncStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isFetching: false,
      isLoadingMore: false,
      isSyncingAll: false,
      syncAllProgress: null,
      isEmbeddingBackfilling: false,
      embeddingBackfillProgress: null,
      lastSyncError: null,
    };
    return selector ? selector(state) : state;
  }),
}));

describe("SyncStatusBar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
});
