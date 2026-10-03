/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FC } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useSearchHistoryUndo } from "../hooks/useSearchHistoryUndo";
import { initializeSearchHistoryStore, useSearchHistoryStore } from "../stores/searchHistoryStore";
import { HomeMain } from "./HomeMain";

/**
 * HomeMain の検索履歴（#86）
 *
 * - モバイル（390px 相当）: 検索欄の手前の折りたたみから、再検索・削除・元に戻す・再試行ができる
 * - デスクトップ: 従来どおりサイドバーに表示する
 * - サイドバーと折りたたみの SearchHistory を同時にマウントしない（live region・フォーカス先の重複を防ぐ）
 */

const { mediaState } = vi.hoisted(() => ({ mediaState: { isDesktop: false } }));

vi.mock("@/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => mediaState.isDesktop,
}));
vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => mediaState.isDesktop,
}));

// 履歴の配置だけを確かめるため、一覧と同期ステータスは検索欄だけの軽い代替にする
vi.mock("./PaperExplorer", () => ({
  PaperExplorer: () => <input type="search" aria-label="論文を検索" />,
}));
vi.mock("./SyncStatusBar", () => ({
  SyncStatusBar: () => null,
}));

const createSampleHistory = (overrides: Partial<SearchHistoryType> = {}): SearchHistoryType => ({
  id: crypto.randomUUID(),
  originalQuery: "強化学習",
  expandedQuery: {
    original: "強化学習",
    english: "reinforcement learning",
    synonyms: [],
    searchText: "reinforcement learning",
  },
  resultCount: 42,
  createdAt: new Date("2026-01-17T10:00:00Z"),
  ...overrides,
});

const noop = () => {};

/** App と同じく、画面幅は useMediaQuery、履歴はストアと useSearchHistoryUndo から渡す */
const ConnectedHomeMain: FC<{ onReSearch: (history: SearchHistoryType) => void }> = ({
  onReSearch,
}) => {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const histories = useSearchHistoryStore((s) => s.histories).slice(0, 10);
  const undo = useSearchHistoryUndo();
  return (
    <HomeMain
      isDesktop={isDesktop}
      displayPapers={[]}
      onSearch={() => Promise.resolve([])}
      onClearSearch={noop}
      onPaperClick={noop}
      externalQuery={null}
      searchInputValue=""
      onSearchInputChange={noop}
      whyReadMap={new Map()}
      isSearchLoading={false}
      expandedPaperId={null}
      expandedQuery={null}
      results={[]}
      isLoading={false}
      selectedPaper={null}
      onCloseDetail={noop}
      currentSummary={undefined}
      onGenerateSummary={() => Promise.resolve()}
      isSummaryLoading={false}
      summaryError={null}
      summaryFailedTarget={null}
      summaryGeneratingTarget={null}
      summaryLanguage="ja"
      onSummaryLanguageChange={noop}
      autoGenerateSummary={false}
      recentHistories={histories}
      onReSearch={onReSearch}
      historyUndo={undo}
      onRunEmbeddingBackfill={noop}
    />
  );
};

describe("HomeMain の検索履歴", () => {
  let db: LuminaDB;
  let dbCounter = 0;

  const seed = async (queries: string[]) => {
    dbCounter += 1;
    db = createLuminaDb(`HomeMain-search-history-test-${dbCounter}`);
    await initializeSearchHistoryStore(db);
    // 先頭ほど新しい
    for (const [i, query] of queries.entries()) {
      await useSearchHistoryStore.getState().addHistory(
        createSampleHistory({
          originalQuery: query,
          createdAt: new Date(Date.UTC(2026, 0, 20 - i)),
        })
      );
    }
  };

  /** 文書内の live region（非表示の領域内も含む）の数 */
  const countLiveRegions = () => screen.queryAllByRole("status", { hidden: true }).length;

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    mediaState.isDesktop = false;
    await db?.delete();
  });

  describe("モバイル（390px 相当）", () => {
    it("履歴は折りたたまれており、開閉ボタンで開ける。開いてもフォーカスは開閉ボタンに残る", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);

      const toggle = screen.getByRole("button", { name: "検索履歴" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      expect(panel).not.toBeNull();
      expect(panel).not.toBeVisible();
      expect(screen.queryByRole("button", { name: /^A検索/ })).not.toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(panel).toBeVisible();
      expect(screen.getByRole("button", { name: /^A検索/ })).toBeInTheDocument();
      expect(toggle).toHaveFocus();
    });

    it("削除ボタンはホバーなしで見える（コンパクト表示の opacity-0 を使わない）", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "検索履歴" }));

      expect(screen.getByRole("button", { name: "「A検索」を削除" })).not.toHaveClass("opacity-0");
    });

    it("履歴から再検索すると折りたたみ、フォーカスを開閉ボタンへ戻す", async () => {
      const user = userEvent.setup();
      const onReSearch = vi.fn();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHomeMain onReSearch={onReSearch} />);
      const toggle = screen.getByRole("button", { name: "検索履歴" });

      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: /^B検索/ }));

      expect(onReSearch).toHaveBeenCalledTimes(1);
      expect(onReSearch.mock.calls[0]?.[0]).toMatchObject({ originalQuery: "B検索" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });

    it("削除するとUndoを表示・通知し、フォーカスを次の行へ移す。Undoで元に戻る", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索", "C検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "検索履歴" }));

      await user.click(screen.getByRole("button", { name: "「B検索」を削除" }));

      const undo = await screen.findByRole("button", { name: "「B検索」を元に戻す" });
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「B検索」を削除しました")
      );
      await waitFor(() => expect(screen.getByRole("button", { name: /^C検索/ })).toHaveFocus());

      await user.click(undo);

      await waitFor(() => expect(screen.getByRole("button", { name: /^B検索/ })).toHaveFocus());
      expect(screen.getByRole("status")).toHaveTextContent("「B検索」を元に戻しました");
      expect(countLiveRegions()).toBe(1);
    });

    it("削除に失敗すると行のそばにエラーを残し、再試行で削除できる", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      vi.spyOn(db.searchHistories, "delete").mockRejectedValueOnce(new Error("DB書き込み失敗"));
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "検索履歴" }));

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "削除できませんでした: DB書き込み失敗"
      );

      await user.click(screen.getByRole("button", { name: "「A検索」の削除を再試行" }));

      await screen.findByRole("button", { name: "「A検索」を元に戻す" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("Esc で折りたたみ、フォーカスを開閉ボタンへ戻す", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: "検索履歴" });
      await user.click(toggle);
      screen.getByRole("button", { name: /^A検索/ }).focus();

      await user.keyboard("{Escape}");

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });

    it("サイドバーの履歴はマウントしない（履歴一覧と live region は1つだけ）", async () => {
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);

      expect(countLiveRegions()).toBe(1);
      expect(screen.getAllByRole("button", { name: /^A検索/, hidden: true })).toHaveLength(1);
    });
  });

  describe("デスクトップ", () => {
    it("従来どおりサイドバーに履歴を表示し、折りたたみの開閉ボタンは出さない", async () => {
      mediaState.isDesktop = true;
      const user = userEvent.setup();
      const onReSearch = vi.fn();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHomeMain onReSearch={onReSearch} />);

      expect(screen.queryByRole("button", { name: "検索履歴" })).not.toBeInTheDocument();
      const sidebar = screen.getByRole("complementary");
      expect(within(sidebar).getByText("検索履歴")).toBeInTheDocument();
      expect(countLiveRegions()).toBe(1);
      expect(screen.getAllByRole("button", { name: /^A検索/, hidden: true })).toHaveLength(1);

      await user.click(within(sidebar).getByRole("button", { name: /^A検索/ }));
      expect(onReSearch).toHaveBeenCalledTimes(1);

      await user.click(within(sidebar).getByRole("button", { name: "「B検索」を削除" }));
      await within(sidebar).findByRole("button", { name: "「B検索」を元に戻す" });
    });
  });
});
