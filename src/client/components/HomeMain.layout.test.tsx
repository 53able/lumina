/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { usePaperStore } from "../stores/paperStore";
import { useSyncStore } from "../stores/syncStore";
import { HomeMain } from "./HomeMain";

/**
 * HomeMain の配置（#68）
 *
 * - 主な順序は 検索欄 → 検索範囲・絞り込み条件 → 論文一覧。同期の詳細と一括取得は検索欄より上に置かない
 * - デスクトップ（1440×900 相当）: 同期はサイドバー（補助領域）。進行中の停止・失敗と再試行はそこで見える
 * - モバイル（390×844 相当）: 同期は一覧の下
 */

// 配置だけを確かめるため、一覧は検索欄だけの軽い代替にする（同期ステータスは実物）
vi.mock("./PaperExplorer", () => ({
  PaperExplorer: () => <input type="search" aria-label="論文を検索" />,
}));

const noop = () => {};

const paper: Paper = {
  id: "2401.00001",
  title: "Paper",
  abstract: "Abstract",
  authors: [],
  categories: ["cs.CL"],
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  pdfUrl: "",
  arxivUrl: "",
};

const renderHomeMain = (isDesktop: boolean) =>
  render(
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
      recentHistories={[]}
      onReSearch={noop}
      onRunEmbeddingBackfill={noop}
      onStopSync={noop}
      onRetrySync={noop}
    />
  );

/** a が b より文書順で前にあるか */
const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("HomeMain の配置（#68）", () => {
  beforeEach(() => {
    usePaperStore.setState({ papers: [paper] });
    // 同期の進行中と失敗（停止・再試行の導線が出る状態）
    useSyncStore.setState({ isFetching: true, lastSyncError: new Error("network error") });
  });

  afterEach(() => {
    cleanup();
    usePaperStore.setState({ papers: [] });
    useSyncStore.setState({ isFetching: false, lastSyncError: null });
  });

  it("デスクトップ: 同期はサイドバーにあり、論文一覧側（main）の検索欄より上に出さない", () => {
    renderHomeMain(true);

    const main = screen.getByRole("main");
    const sidebar = screen.getByRole("complementary");
    const sync = within(sidebar).getByRole("region", { name: "同期" });

    expect(main.contains(sync)).toBe(false);
    expect(within(main).queryByRole("button", { name: "同期を停止" })).not.toBeInTheDocument();
    // main の最初の操作は検索欄
    expect(main.querySelector("input, button")).toBe(within(main).getByRole("searchbox"));
  });

  it("デスクトップ: 同期の進行中は停止、失敗は理由と再試行がサイドバーで見える", () => {
    renderHomeMain(true);

    const sync = screen.getByRole("region", { name: "同期" });
    expect(within(sync).getByRole("button", { name: "同期を停止" })).toBeVisible();
    expect(within(sync).getByTestId("sync-error")).toHaveTextContent("論文の同期に失敗しました");
    expect(within(sync).getByRole("button", { name: "同期を再試行" })).toBeInTheDocument();
  });

  it("モバイル: 同期は検索欄より後（一覧の下）に置き、停止・失敗も表示する", () => {
    renderHomeMain(false);

    const searchbox = screen.getByRole("searchbox");
    const stop = screen.getByRole("button", { name: "同期を停止" });
    expect(precedes(searchbox, stop)).toBe(true);
    expect(screen.getByTestId("sync-error")).toHaveTextContent("論文の同期に失敗しました");
  });
});
