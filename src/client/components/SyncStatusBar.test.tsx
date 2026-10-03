/**
 * @vitest-environment jsdom
 *
 * Design Doc: tmp/mobile-embedding-as-is-analysis.md
 * 期待動作: モバイル表示（compact=true）のときも「Embeddingを補完」ボタンが表示され、押下でバックフィルが実行可能であること。
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingBackfillOutcome } from "../lib/embeddingBackfillOutcome";

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
  embeddingBackfillOutcome: null as EmbeddingBackfillOutcome | null,
  setEmbeddingBackfillOutcome: vi.fn(),
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
    mockSyncStoreState.embeddingBackfillOutcome = null;
    mockSyncStoreState.lastSyncError = null;
  });

  describe("Embedding補完の結果表示", () => {
    it("成功時は完了件数を status として通知し、再試行ボタンは出さない", async () => {
      mockSyncStoreState.embeddingBackfillOutcome = {
        status: "success",
        completed: 3,
        total: 3,
        failure: null,
      };
      const { SyncStatusBar } = await import("./SyncStatusBar");

      render(<SyncStatusBar onRunEmbeddingBackfill={vi.fn()} />);

      expect(screen.getByRole("status")).toHaveTextContent("Embeddingを3件補完しました");
      expect(screen.queryByRole("button", { name: /未処理分を再試行/ })).not.toBeInTheDocument();
    });

    it("部分成功時は完了件数・理由・案内を alert で通知し、未処理分だけ再試行できる", async () => {
      mockSyncStoreState.embeddingBackfillOutcome = {
        status: "partial",
        completed: 2,
        total: 3,
        failure: {
          kind: "server",
          reason: "サーバーでエラーが発生しました（500）",
          guidance: "時間をおいて、未処理分を再試行してください。",
        },
      };
      const { SyncStatusBar } = await import("./SyncStatusBar");
      const onRunEmbeddingBackfill = vi.fn();

      render(<SyncStatusBar onRunEmbeddingBackfill={onRunEmbeddingBackfill} />);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Embeddingを一部補完しました（2 / 3件）");
      expect(alert).toHaveTextContent("サーバーでエラーが発生しました（500）");
      // 変動する未処理件数は読み上げ領域に含めない（件数変化で再読み上げさせない）
      expect(alert).not.toHaveTextContent("未処理");
      const notice = screen.getByTestId("embedding-backfill-outcome");
      expect(notice).toHaveTextContent("補完済みの分は保存されています");
      expect(notice).toHaveTextContent("未処理: 1件");
      // 通常の補完ボタンは結果欄の再試行に集約される
      expect(
        screen.queryByRole("button", { name: "Embedding未設定の論文を補完" })
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "未処理分を再試行（1件）" }));
      expect(onRunEmbeddingBackfill).toHaveBeenCalledTimes(1);
    });

    it("失敗時は原因に合う案内を残し、閉じるで結果を消せる", async () => {
      mockSyncStoreState.embeddingBackfillOutcome = {
        status: "failed",
        completed: 0,
        total: 1,
        failure: {
          kind: "auth",
          reason: "OpenAI APIキーを利用できませんでした（認証エラー）",
          guidance: "設定でAPIキーを確認・再登録してから、未処理分を再試行してください。",
        },
      };
      const { SyncStatusBar } = await import("./SyncStatusBar");

      render(<SyncStatusBar compact onRunEmbeddingBackfill={vi.fn()} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Embeddingを補完できませんでした。OpenAI APIキーを利用できませんでした（認証エラー）"
      );
      expect(screen.getByTestId("embedding-backfill-outcome")).toHaveTextContent(
        "設定でAPIキーを確認"
      );

      await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
      expect(mockSyncStoreState.setEmbeddingBackfillOutcome).toHaveBeenCalledWith(null);
    });

    it("補完の実行中は前回の結果を表示しない", async () => {
      mockSyncStoreState.isEmbeddingBackfilling = true;
      mockSyncStoreState.embeddingBackfillOutcome = {
        status: "failed",
        completed: 0,
        total: 1,
        failure: { kind: "network", reason: "ネットワークに接続できませんでした", guidance: "g" },
      };
      const { SyncStatusBar } = await import("./SyncStatusBar");

      render(<SyncStatusBar onRunEmbeddingBackfill={vi.fn()} />);

      expect(screen.queryByTestId("embedding-backfill-outcome")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    });
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
