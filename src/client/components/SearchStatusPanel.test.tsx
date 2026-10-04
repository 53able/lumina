/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDisabledError, SearchApiError } from "../lib/api";
import {
  RECOMPUTE_FAILURE_MESSAGES,
  RECOMPUTE_FAILURE_TITLE,
  SEARCH_FAILURE_MESSAGES,
  SearchComputeError,
} from "../lib/searchErrors";
import {
  ELAPSED_TIME_VISIBLE_AFTER_SEC,
  SEARCH_FAILURE_EXPLAINED_IN_LIST,
  SearchStatusPanel,
} from "./SearchStatusPanel";

const baseProps = {
  query: "B",
  isLoading: false,
  error: null,
  previousQuery: null,
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe("SearchStatusPanel（#71）", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("検索中は一定秒数を過ぎてから経過時間を出し、進捗率は出さない", () => {
    vi.useFakeTimers();
    render(<SearchStatusPanel {...baseProps} isLoading />);

    expect(screen.getByText(/「B」を検索中/)).toBeInTheDocument();
    expect(screen.queryByText(/経過/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime((ELAPSED_TIME_VISIBLE_AFTER_SEC - 1) * 1000);
    });
    expect(screen.queryByText(/経過/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(`経過 ${ELAPSED_TIME_VISIBLE_AFTER_SEC + 1}秒`)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("前回の結果がなければ「検索を中止」、あれば「中止して前回の結果に戻る」を出す", () => {
    const { rerender } = render(<SearchStatusPanel {...baseProps} isLoading />);
    expect(screen.getByRole("button", { name: "検索を中止" })).toBeInTheDocument();

    rerender(<SearchStatusPanel {...baseProps} isLoading previousQuery="A" />);
    expect(screen.getByRole("button", { name: "中止して前回の結果に戻る" })).toBeInTheDocument();
    expect(screen.getByText(/「B」を検索中/)).toHaveTextContent('表示中は前回の結果（"A"）です');
  });

  it("検索中でも失敗でもなければ何も出さない", () => {
    const { container } = render(<SearchStatusPanel {...baseProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["API利用OFF", new ApiDisabledError(), false, true],
    ["認証（403）", new SearchApiError("forbidden", 403), false, true],
    ["キー復号失敗", Object.assign(new Error("decrypt"), { name: "OperationError" }), false, true],
    ["上限（429）", new SearchApiError("too many", 429), true, false],
    ["サーバー（500）", new SearchApiError("upstream", 500), true, true],
    ["論文の読み込み失敗", Object.assign(new Error("db"), { name: "PaperLoadError" }), true, false],
    ["索引での計算の失敗", new SearchComputeError("worker"), true, false],
    ["その他", new Error("network"), true, false],
  ])("失敗（%s）では、分類に合わせて再試行と設定の案内を出し分ける", (_label, error, canRetry, suggestSettings) => {
    render(<SearchStatusPanel {...baseProps} error={error} previousQuery="A" />);

    expect(screen.queryByRole("button", { name: "同じ条件で再試行" }) !== null).toBe(canRetry);
    expect(screen.queryByRole("button", { name: "設定を開く" }) !== null).toBe(suggestSettings);
    expect(screen.getByRole("button", { name: "条件を編集" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前結果を見る" })).toBeInTheDocument();
  });

  it("前回の結果がない失敗では「前結果を見る」を出さない", () => {
    render(<SearchStatusPanel {...baseProps} error={new Error("network")} />);
    expect(screen.queryByRole("button", { name: "前結果を見る" })).not.toBeInTheDocument();
  });

  it.each([
    ["キー復号失敗", Object.assign(new Error("decrypt"), { name: "OperationError" }), "decrypt"],
    [
      "論文の読み込み失敗",
      Object.assign(new Error("db"), { name: "PaperLoadError" }),
      "paper_load",
    ],
  ] as const)("前回の結果がない%sは、一覧に出す理由をここで繰り返さない（前回の結果があればここに出す）", (_label, error, kind) => {
    const { rerender } = render(<SearchStatusPanel {...baseProps} error={error} />);
    expect(screen.getByText(SEARCH_FAILURE_EXPLAINED_IN_LIST)).toBeInTheDocument();
    expect(screen.queryByText(SEARCH_FAILURE_MESSAGES[kind])).not.toBeInTheDocument();

    rerender(<SearchStatusPanel {...baseProps} error={error} previousQuery="A" />);
    expect(screen.getByText(SEARCH_FAILURE_MESSAGES[kind])).toBeInTheDocument();
    expect(screen.queryByText(SEARCH_FAILURE_EXPLAINED_IN_LIST)).not.toBeInTheDocument();
  });

  describe("確定した結果の再計算の失敗（#100）", () => {
    it.each([
      ["索引での計算の失敗", new SearchComputeError("worker"), RECOMPUTE_FAILURE_MESSAGES.compute],
      [
        "論文の読み込み失敗",
        Object.assign(new Error("db"), { name: "PaperLoadError" }),
        RECOMPUTE_FAILURE_MESSAGES.paper_load,
      ],
    ])("%sは新しい検索の失敗と別の文言で出し、前結果を見る・条件を編集は出さない", (_label, error, message) => {
      const onRetry = vi.fn();
      render(
        <SearchStatusPanel
          {...baseProps}
          query="A"
          error={error}
          isRecomputeFailure
          onRetry={onRetry}
        />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(RECOMPUTE_FAILURE_TITLE);
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.getByText('表示中の結果: "A"')).toBeInTheDocument();
      expect(screen.queryByText(/を検索できませんでした/)).not.toBeInTheDocument();
      expect(screen.queryByText(/前回の結果/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "前結果を見る" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "条件を編集" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "設定を開く" })).not.toBeInTheDocument();

      screen.getByRole("button", { name: "結果の更新を再試行" }).click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("同じエラーでも新しい検索の失敗では従来の文言と操作を出す", () => {
      render(
        <SearchStatusPanel
          {...baseProps}
          query="B"
          error={new SearchComputeError("worker")}
          previousQuery="A"
        />
      );

      expect(screen.getByText("「B」を検索できませんでした")).toBeInTheDocument();
      expect(screen.getByText('表示中は前回の結果（"A"）です。')).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "前結果を見る" })).toBeInTheDocument();
      expect(screen.queryByText(RECOMPUTE_FAILURE_TITLE)).not.toBeInTheDocument();
    });
  });
});
