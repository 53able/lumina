/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePaperStore } from "../stores/paperStore";
import { resetPaperStoreForTest } from "../testing/paperStoreTestUtils";
import { PaperLoadStatus } from "./PaperLoadStatus";

describe("PaperLoadStatus", () => {
  afterEach(() => {
    cleanup();
    resetPaperStoreForTest();
  });

  it("読み込み中は読み込み済み件数と総件数を表示する", () => {
    usePaperStore.setState({ loadStatus: "loading", loadedCount: 1200, totalCount: 55531 });
    render(<PaperLoadStatus />);

    const status = screen.getByTestId("paper-load-status");
    expect(status).toHaveAttribute("data-status", "loading");
    expect(status).toHaveTextContent("保存済みの論文を読み込み中 1,200 / 55,531 件");
  });

  it("失敗時は理由と再試行を表示し、再試行で読み込み直す", async () => {
    const retryLoad = vi.fn(async () => {});
    usePaperStore.setState({
      loadStatus: "error",
      loadError: new Error("保存済みの論文を読み込めませんでした: IndexedDB が開けません"),
      retryLoad,
    });
    render(<PaperLoadStatus />);

    expect(screen.getByRole("alert")).toHaveTextContent("保存済みの論文を読み込めませんでした");
    expect(screen.getByText(/IndexedDB が開けません/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(retryLoad).toHaveBeenCalledTimes(1);
  });

  it("全件の準備完了後は何も表示しない", () => {
    usePaperStore.setState({ loadStatus: "ready", loadedCount: 3, totalCount: 3 });
    const { container } = render(<PaperLoadStatus />);

    expect(container).toBeEmptyDOMElement();
  });
});
