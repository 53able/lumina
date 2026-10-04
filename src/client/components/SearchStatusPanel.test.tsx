/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDisabledError, SearchApiError } from "../lib/api";
import { ELAPSED_TIME_VISIBLE_AFTER_SEC, SearchStatusPanel } from "./SearchStatusPanel";

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
});
