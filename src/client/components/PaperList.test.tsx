/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";

// InteractionContextをモック（PaperCardで使用される）
vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteraction: (_paperId: string) => ({
    isLiked: false,
    isBookmarked: false,
    toggleLike: vi.fn(),
    toggleBookmark: vi.fn(),
  }),
}));

/** PaperList は isSyncing / 直近の同期エラーを syncStore から取得。テストで状態を再現するためにモック状態を差し替える */
interface MockSyncStoreState {
  isFetching: boolean;
  isLoadingMore: boolean;
  lastSyncError?: Error | null;
  savingSyncedPapersCount?: number;
  isSyncingAll?: boolean;
  isSyncingFromDate?: boolean;
}
let mockSyncStoreState: MockSyncStoreState = { isFetching: false, isLoadingMore: false };
vi.mock("../stores/syncStore", () => ({
  useSyncStore: (selector: (s: MockSyncStoreState) => unknown) => selector(mockSyncStoreState),
}));

/** 空表示は保存済み論文数で「未同期」と「条件に一致しない」を分ける */
let mockPaperStoreState = { papers: [] as Paper[], isLoading: false };
vi.mock("../stores/paperStore", () => ({
  usePaperStore: (selector: (s: typeof mockPaperStoreState) => unknown) =>
    selector(mockPaperStoreState),
}));

/** 同期に成功したことがあるか（最終同期日時）で「未同期」と「同期済み・該当なし」を分ける */
let mockLastSyncedAt: string | null = null;
vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: { lastSyncedAt: string | null }) => unknown) =>
    selector({ lastSyncedAt: mockLastSyncedAt }),
}));

vi.mock("../hooks/useGridVirtualizer", () => ({
  useGridVirtualizer: (params: { items: Paper[] }) => {
    const items = params.items;
    return {
      virtualRows:
        items.length === 0
          ? []
          : [
              {
                index: 0,
                start: 0,
                items,
                isExpanded: false,
              },
            ],
      totalSize: items.length * 300,
      columnCount: Math.max(items.length, 1),
      measureElement: () => undefined,
    };
  },
}));

/**
 * MemoryRouterでラップしたレンダリングヘルパー
 */
const renderWithRouter = (ui: ReactNode) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

/**
 * PaperList テスト
 *
 * Design Docsに基づく仕様:
 * - 論文カードのリスト表示
 * - 空の場合のメッセージ表示
 * - ローディング状態の表示
 * - 無限スクロール（スクロールイベント）
 */

// テスト用のサンプル論文データ
const createSamplePaper = (id: string, title: string): Paper => ({
  id,
  title,
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-16"),
  pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
});

describe("PaperList", () => {
  afterEach(() => {
    mockSyncStoreState = { isFetching: false, isLoadingMore: false };
    mockPaperStoreState = { papers: [], isLoading: false };
    mockLastSyncedAt = null;
    cleanup();
    vi.clearAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 論文リストが表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "First Paper"),
        createSamplePaper("2401.00002", "Second Paper"),
        createSamplePaper("2401.00003", "Third Paper"),
      ];

      renderWithRouter(<PaperList papers={papers} />);

      expect(screen.getByText("First Paper")).toBeInTheDocument();
      expect(screen.getByText("Second Paper")).toBeInTheDocument();
      expect(screen.getByText("Third Paper")).toBeInTheDocument();
    });

    it("正常系: 論文が未取得の場合は未同期の説明と「同期」「設定を開く」が表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const onSync = vi.fn();
      const onOpenSettings = vi.fn();

      renderWithRouter(<PaperList papers={[]} onSync={onSync} onOpenSettings={onOpenSettings} />);

      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "not-synced");
      expect(screen.getByText("このデバイスにはまだ論文がありません")).toBeInTheDocument();
      expect(screen.queryByText(/条件に一致する論文がありません/)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "論文を同期" }));
      expect(onSync).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole("button", { name: "設定を開く" }));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("正常系: 論文が未取得で同期に失敗した場合は理由と「同期を再試行」が表示される", async () => {
      const { PaperList } = await import("./PaperList");
      mockSyncStoreState = {
        isFetching: false,
        isLoadingMore: false,
        lastSyncError: new Error("Sync failed: 503"),
      };
      const onSync = vi.fn();
      const onRetrySync = vi.fn();

      renderWithRouter(
        <PaperList papers={[]} onSync={onSync} onRetrySync={onRetrySync} onOpenSettings={vi.fn()} />
      );

      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "sync-failed");
      expect(screen.getByText("論文を同期できませんでした")).toBeInTheDocument();
      expect(screen.getByText(/Sync failed: 503/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "設定を開く" })).not.toBeInTheDocument();

      // 再試行は失敗した処理をやり直す onRetrySync を呼ぶ（キャッシュを使う onSync ではない）
      await userEvent.click(screen.getByRole("button", { name: "同期を再試行" }));
      expect(onRetrySync).toHaveBeenCalledTimes(1);
      expect(onSync).not.toHaveBeenCalled();
    });

    it.each([
      ["すべて取得", { isSyncingAll: true }],
      ["指定日以前の取得", { isSyncingFromDate: true }],
    ] as const)("正常系: 同期失敗の後に%sで再試行している間は取得中にし、再試行ボタンを出さない", async (_label, syncing) => {
      const { PaperList } = await import("./PaperList");
      mockSyncStoreState = {
        isFetching: false,
        isLoadingMore: false,
        lastSyncError: new Error("Sync failed: 503"),
        ...syncing,
      };

      renderWithRouter(<PaperList papers={[]} onRetrySync={vi.fn()} />);

      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "loading");
      expect(screen.queryByRole("button", { name: "同期を再試行" })).not.toBeInTheDocument();
    });

    it("正常系: 同期に成功して論文が0件の場合は同期期間・カテゴリの見直しを案内する", async () => {
      const { PaperList } = await import("./PaperList");
      mockLastSyncedAt = "2026-10-01T00:00:00.000Z";
      const onOpenSettings = vi.fn();

      renderWithRouter(<PaperList papers={[]} onSync={vi.fn()} onOpenSettings={onOpenSettings} />);

      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "synced-empty");
      expect(screen.getByText("同期期間に該当する論文がありませんでした")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "設定を開く" }));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("正常系: 自動同期の予定中や取得した論文の保存中は「論文がありません」を出さず取得中にする", async () => {
      const { PaperList } = await import("./PaperList");

      const { rerender } = renderWithRouter(
        <PaperList papers={[]} isSyncPending onSync={vi.fn()} />
      );
      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "loading");

      mockSyncStoreState = { isFetching: false, isLoadingMore: false, savingSyncedPapersCount: 1 };
      mockLastSyncedAt = "2026-10-01T00:00:00.000Z";
      rerender(
        <MemoryRouter>
          <PaperList papers={[]} onSync={vi.fn()} />
        </MemoryRouter>
      );
      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "loading");
      expect(screen.queryByRole("button", { name: "論文を同期" })).not.toBeInTheDocument();
    });

    it("正常系: 論文が保存済みなら同期中でも検索0件の理由と解除操作を出す", async () => {
      const { PaperList } = await import("./PaperList");
      mockPaperStoreState = {
        papers: [createSamplePaper("2401.00001", "Stored Paper")],
        isLoading: false,
      };
      mockSyncStoreState = { isFetching: true, isLoadingMore: false };

      renderWithRouter(
        <PaperList
          papers={[]}
          emptyMessage={<p>該当する論文がありませんでした</p>}
          onClearConditions={vi.fn()}
        />
      );

      expect(screen.getByText("該当する論文がありませんでした")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "検索・絞り込みを解除" })).toBeInTheDocument();
      expect(screen.queryByText(/論文を取得しています/)).not.toBeInTheDocument();
    });

    it("正常系: 論文は保存済みで検索・絞り込みが0件の場合は条件の説明と「検索・絞り込みを解除」が表示される", async () => {
      const { PaperList } = await import("./PaperList");
      mockPaperStoreState = {
        papers: [createSamplePaper("2401.00001", "Stored Paper")],
        isLoading: false,
      };
      // 以前の同期失敗が残っていても、論文があれば0件の原因は検索条件
      mockSyncStoreState = {
        isFetching: false,
        isLoadingMore: false,
        lastSyncError: new Error("Sync failed: 503"),
      };
      const onClearConditions = vi.fn();

      renderWithRouter(
        <PaperList
          papers={[]}
          onSync={vi.fn()}
          onOpenSettings={vi.fn()}
          onClearConditions={onClearConditions}
        />
      );

      expect(screen.getByTestId("paper-list-empty")).toHaveAttribute("data-kind", "no-results");
      expect(screen.getByText("条件に一致する論文がありません")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "同期を再試行" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "検索・絞り込みを解除" }));
      expect(onClearConditions).toHaveBeenCalledTimes(1);
    });

    it("正常系: 検索0件の理由（emptyMessage）があれば説明はそれを使い、解除操作は残す", async () => {
      const { PaperList } = await import("./PaperList");
      mockPaperStoreState = {
        papers: [createSamplePaper("2401.00001", "Stored Paper")],
        isLoading: false,
      };

      renderWithRouter(
        <PaperList
          papers={[]}
          emptyMessage={<p>該当する論文がありませんでした</p>}
          onClearConditions={vi.fn()}
        />
      );

      expect(screen.getByText("該当する論文がありませんでした")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "検索・絞り込みを解除" })).toBeInTheDocument();
    });

    it("正常系: 論文が未取得なら検索0件の理由より未同期の説明を優先する", async () => {
      const { PaperList } = await import("./PaperList");

      renderWithRouter(
        <PaperList papers={[]} emptyMessage={<p>該当する論文がありませんでした</p>} />
      );

      expect(screen.getByText("このデバイスにはまだ論文がありません")).toBeInTheDocument();
      expect(screen.queryByText("該当する論文がありませんでした")).not.toBeInTheDocument();
    });

    it("正常系: 同期中で空の場合は「取得しています」が表示され検索向けメッセージは出ない", async () => {
      const { PaperList } = await import("./PaperList");
      mockSyncStoreState = { isFetching: true, isLoadingMore: false };

      renderWithRouter(<PaperList papers={[]} />);

      expect(screen.getByText(/論文を取得しています/)).toBeInTheDocument();
      expect(screen.queryByText(/条件に一致する論文がありません/)).not.toBeInTheDocument();
      expect(screen.queryByText(/このデバイスにはまだ論文がありません/)).not.toBeInTheDocument();
    });

    it("正常系: ローディング中はスケルトンが表示される", async () => {
      const { PaperList } = await import("./PaperList");

      renderWithRouter(<PaperList papers={[]} isLoading />);

      // ローディング中のスケルトン要素を確認
      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
    });
  });

  describe("論文数の表示", () => {
    it("正常系: 論文数が表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "Paper 1"),
        createSamplePaper("2401.00002", "Paper 2"),
      ];

      renderWithRouter(<PaperList papers={papers} showCount />);

      // 件数と「件の論文」が表示されていることを確認
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText(/件の論文/)).toBeInTheDocument();
    });
  });

  describe("whyReadMap伝播", () => {
    it("正常系: whyReadMapの内容がカードに表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "Paper 1"),
        createSamplePaper("2401.00002", "Paper 2"),
      ];
      const whyReadMap = new Map([
        ["2401.00001", "最新の機械学習手法を理解できます"],
        ["2401.00002", "データ分析の効率化に役立ちます"],
      ]);

      renderWithRouter(<PaperList papers={papers} whyReadMap={whyReadMap} />);

      expect(screen.getByText("最新の機械学習手法を理解できます")).toBeInTheDocument();
      expect(screen.getByText("データ分析の効率化に役立ちます")).toBeInTheDocument();
    });

    it("正常系: whyReadMapが空でもエラーにならない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [createSamplePaper("2401.00001", "Paper 1")];

      renderWithRouter(<PaperList papers={papers} whyReadMap={new Map()} />);

      expect(screen.getByText("Paper 1")).toBeInTheDocument();
    });
  });

  describe("無限スクロール（スクロールイベント）", () => {
    /**
     * スクロールイベントをシミュレートするヘルパー
     * 仮想スクロールコンテナ内でスクロール末尾に近づいた状態をシミュレート
     */
    const simulateScrollNearBottom = (container: HTMLElement) => {
      // scrollHeight, clientHeight, scrollTop をモック
      Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(container, "clientHeight", { value: 800, configurable: true });
      Object.defineProperty(container, "scrollTop", { value: 1100, configurable: true }); // 2000 - 800 - 1100 = 100 < 300

      // スクロールイベントを発火
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    };

    it("正常系: スクロール末尾に到達するとonRequestSyncが呼ばれる", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      renderWithRouter(<PaperList papers={papers} onRequestSync={onRequestSync} />);

      // 仮想スクロールコンテナを取得（overflow-auto を持つ要素）
      const scrollContainer = document.querySelector(".overflow-auto");
      expect(scrollContainer).not.toBeNull();

      // スクロール末尾に近づいた状態をシミュレート
      act(() => {
        simulateScrollNearBottom(scrollContainer as HTMLElement);
      });

      expect(onRequestSync).toHaveBeenCalledTimes(1);
    });

    it("正常系: isSyncingがtrueの場合はonRequestSyncが呼ばれない", async () => {
      const { PaperList } = await import("./PaperList");
      mockSyncStoreState = { isFetching: true, isLoadingMore: false };
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      renderWithRouter(<PaperList papers={papers} onRequestSync={onRequestSync} />);

      // 仮想スクロールコンテナを取得
      const scrollContainer = document.querySelector(".overflow-auto");
      expect(scrollContainer).not.toBeNull();

      // スクロール末尾に近づいた状態をシミュレート
      act(() => {
        simulateScrollNearBottom(scrollContainer as HTMLElement);
      });

      // isSyncing が true なので呼ばれない
      expect(onRequestSync).not.toHaveBeenCalled();
    });

    it("バグ修正: ページリロード直後はスクロールなしでonRequestSyncが発火しない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      // 初回レンダリング（syncStore はデフォルトで isSyncing: false）
      mockSyncStoreState = { isFetching: false, isLoadingMore: false };
      renderWithRouter(<PaperList papers={papers} onRequestSync={onRequestSync} />);

      // microtask を処理
      await act(async () => {
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      });

      // スクロールイベントなしでは onRequestSync は呼ばれない
      // （以前の IntersectionObserver ベースの実装では、初回レンダリング時に発火していた）
      expect(onRequestSync).not.toHaveBeenCalled();
    });
  });
});
