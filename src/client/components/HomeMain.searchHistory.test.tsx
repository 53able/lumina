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
 * - 折りたたみ中も、通知（パネル外の live region）と開閉ボタンの件数で操作の結果が分かる
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
  const histories = useSearchHistoryStore((s) => s.histories);
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
      searchHistories={histories}
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

      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
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

      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      expect(screen.getByRole("button", { name: "「A検索」を削除" })).not.toHaveClass("opacity-0");
    });

    it("履歴から再検索すると折りたたみ、フォーカスを開閉ボタンへ戻す", async () => {
      const user = userEvent.setup();
      const onReSearch = vi.fn();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHomeMain onReSearch={onReSearch} />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });

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
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      await user.click(screen.getByRole("button", { name: "「B検索」を削除" }));

      const undo = await screen.findByRole("button", { name: "「B検索」を元に戻す" });
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「B検索」を削除しました")
      );
      await waitFor(() => expect(screen.getByRole("button", { name: /^C検索/ })).toHaveFocus());

      await user.click(undo);

      // フォーカス移動は完了検知の effect 内で即時、通知はその後の再描画で出るため、どちらも待つ
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「B検索」を元に戻しました")
      );
      await waitFor(() => expect(screen.getByRole("button", { name: /^B検索/ })).toHaveFocus());
      expect(countLiveRegions()).toBe(1);
    });

    it("削除に失敗すると行のそばにエラーを残し、再試行で削除できる", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      vi.spyOn(db.searchHistories, "delete").mockRejectedValueOnce(new Error("DB書き込み失敗"));
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

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
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      await user.click(toggle);
      screen.getByRole("button", { name: /^A検索/ }).focus();

      await user.keyboard("{Escape}");

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });

    it("サイドバーの履歴はマウントしない（<aside> も描画せず、履歴一覧と live region は1つだけ）", async () => {
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);

      expect(screen.queryByRole("complementary", { hidden: true })).not.toBeInTheDocument();
      expect(countLiveRegions()).toBe(1);
      expect(screen.getAllByRole("button", { name: /^A検索/, hidden: true })).toHaveLength(1);
    });

    it("開閉ボタンに保存しているすべての履歴の件数を「全N件」として出す（0件でも分かる）", async () => {
      await seed([]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);

      expect(screen.getByRole("button", { name: /^検索履歴/ })).toHaveAccessibleName(
        "検索履歴、全0件"
      );
    });

    /** 11件の履歴を1回の書き込みで保存してからストアへ読み込む（1件ずつ addHistory するより軽い） */
    const seedEleven = async () => {
      dbCounter += 1;
      db = createLuminaDb(`HomeMain-search-history-test-${dbCounter}`);
      await db.searchHistories.bulkAdd(
        Array.from({ length: 11 }, (_, i) =>
          createSampleHistory({
            originalQuery: `検索${i + 1}`,
            createdAt: new Date(Date.UTC(2026, 0, 20 - i)),
          })
        )
      );
      await initializeSearchHistoryStore(db);
    };

    /** 開閉ボタンを押してパネルを開き、パネルを返す（パネル内に絞って探す） */
    const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      await user.click(toggle);
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      return { toggle, panel: within(panel as HTMLElement) };
    };

    it("11件以上あれば開閉ボタンに全件数を出し、パネルの「さらに表示」で11件目以降から再検索できる（#112）", async () => {
      const user = userEvent.setup();
      await seedEleven();
      const onReSearch = vi.fn();
      render(<ConnectedHomeMain onReSearch={onReSearch} />);
      const { toggle, panel } = await openPanel(user);
      expect(toggle).toHaveAccessibleName("検索履歴、全11件");

      expect(panel.queryByRole("button", { name: /^検索11/ })).not.toBeInTheDocument();
      await user.click(panel.getByRole("button", { name: "さらに表示（残り1件）" }));
      const row = panel.getByRole("button", { name: /^検索11/ });
      expect(row).toHaveFocus();

      await user.click(row);
      expect(onReSearch).toHaveBeenCalledWith(expect.objectContaining({ originalQuery: "検索11" }));
    });

    it("「さらに表示」で出した11件目を削除・元に戻すと、開閉ボタンの件数も追従する（#112）", async () => {
      const user = userEvent.setup();
      await seedEleven();
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const { toggle, panel } = await openPanel(user);
      await user.click(panel.getByRole("button", { name: "さらに表示（残り1件）" }));

      await user.click(panel.getByRole("button", { name: "「検索11」を削除" }));
      const undo = await panel.findByRole("button", { name: "「検索11」を元に戻す" });
      expect(toggle).toHaveAccessibleName("検索履歴、全10件、元に戻せる1件");
      await user.click(undo);

      await waitFor(() => expect(toggle).toHaveAccessibleName("検索履歴、全11件"));
      expect(panel.getByRole("button", { name: /^検索11/ })).toBeVisible();
    });

    it("通知の live region はパネルの外にあり、折りたたみ中も読み上げ対象になる", async () => {
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");

      // hidden: false（既定）で取れる = 非表示の領域の中にない
      const status = await screen.findByRole("status");
      expect(panel?.contains(status)).toBe(false);
    });

    it("折りたたんだ後に完了した削除は、パネル外で通知し、開閉ボタンに元に戻せる件数を出す", async () => {
      const user = userEvent.setup();
      await seed(["A検索", "B検索"]);
      let resolveDelete: () => void = () => {};
      const realDelete = db.searchHistories.delete.bind(db.searchHistories);
      vi.spyOn(db.searchHistories, "delete").mockImplementationOnce(
        (key) =>
          new Promise<void>((resolve) => {
            resolveDelete = () => {
              void realDelete(key).then(() => resolve());
            };
          })
      );
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      await user.click(toggle);

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await user.keyboard("{Escape}");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      resolveDelete();

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("「A検索」を削除しました")
      );
      expect(toggle).toHaveAccessibleName("検索履歴、全1件、元に戻せる1件");
      // 折りたたみ中はフォーカスを奪わない
      expect(toggle).toHaveFocus();
    });

    it("折りたたんだ後に失敗した削除は、パネル外で通知し、開閉ボタンに失敗件数を出す", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      let rejectDelete: () => void = () => {};
      vi.spyOn(db.searchHistories, "delete").mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectDelete = () => reject(new Error("DB書き込み失敗"));
          })
      );
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      await user.click(toggle);

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      await user.keyboard("{Escape}");
      rejectDelete();

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "「A検索」を削除できませんでした。検索履歴を開いて再試行できます。"
        )
      );
      expect(toggle).toHaveAccessibleName("検索履歴、全1件、失敗1件");

      // 開くと行内のエラーと再試行がある
      await user.click(toggle);
      expect(screen.getByRole("alert")).toHaveTextContent("削除できませんでした: DB書き込み失敗");
      expect(screen.getByRole("button", { name: "「A検索」の削除を再試行" })).toBeVisible();
    });

    it("折りたたんだ後に失敗した元に戻すは、パネル外で通知する", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      const toggle = screen.getByRole("button", { name: /^検索履歴/ });
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));
      const undoButton = await screen.findByRole("button", { name: "「A検索」を元に戻す" });

      let rejectRestore: () => void = () => {};
      vi.spyOn(db.searchHistories, "add").mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRestore = () => reject(new Error("DB closed"));
          })
      );
      await user.click(undoButton);
      await user.keyboard("{Escape}");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      rejectRestore();

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "「A検索」を元に戻せませんでした。検索履歴を開いて再試行できます。"
        )
      );
      expect(toggle).toHaveAccessibleName("検索履歴、全0件、元に戻せる1件、失敗1件");
    });

    it("開いている間の失敗は行内の alert だけで伝え、live region では重ねて通知しない", async () => {
      const user = userEvent.setup();
      await seed(["A検索"]);
      vi.spyOn(db.searchHistories, "delete").mockRejectedValueOnce(new Error("DB書き込み失敗"));
      render(<ConnectedHomeMain onReSearch={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /^検索履歴/ }));

      await user.click(screen.getByRole("button", { name: "「A検索」を削除" }));

      await screen.findByRole("alert");
      expect(screen.getByRole("status")).toHaveTextContent("");
    });
  });

  describe("デスクトップ", () => {
    it("従来どおりサイドバーに履歴を表示し、折りたたみの開閉ボタンは出さない", async () => {
      mediaState.isDesktop = true;
      const user = userEvent.setup();
      const onReSearch = vi.fn();
      await seed(["A検索", "B検索"]);
      render(<ConnectedHomeMain onReSearch={onReSearch} />);

      expect(screen.queryByRole("button", { name: /^検索履歴/ })).not.toBeInTheDocument();
      const sidebar = screen.getByRole("complementary");
      expect(within(sidebar).getByText("検索履歴")).toBeInTheDocument();
      expect(countLiveRegions()).toBe(1);
      expect(screen.getAllByRole("button", { name: /^A検索/, hidden: true })).toHaveLength(1);

      await user.click(within(sidebar).getByRole("button", { name: /^A検索/ }));
      expect(onReSearch).toHaveBeenCalledTimes(1);

      // タッチ端末（pointer: coarse）ではホバーなしで削除ボタンを表示する
      expect(within(sidebar).getByRole("button", { name: "「B検索」を削除" })).toHaveClass(
        "pointer-coarse:opacity-100"
      );

      await user.click(within(sidebar).getByRole("button", { name: "「B検索」を削除" }));
      await within(sidebar).findByRole("button", { name: "「B検索」を元に戻す" });
    });
  });
});
