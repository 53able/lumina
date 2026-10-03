/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpandedQuery } from "../../shared/schemas/index";
import { SearchTextEditor } from "./SearchTextEditor";

/**
 * SearchTextEditor テスト（#31）
 *
 * - Embedding に渡した検索文を折りたたみ詳細で確認できる
 * - 検索文の編集・関連語の除外をして再検索できる（送るのは表示中の検索文）
 */

const expandedQuery: ExpandedQuery = {
  original: "深層学習",
  english: "deep learning",
  synonyms: ["neural network", "Representation Learning", "graph"],
  searchText: "deep learning neural network representation learning",
};

const renderEditor = (props: { isLoading?: boolean } = {}) => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<SearchTextEditor expandedQuery={expandedQuery} onSubmit={onSubmit} {...props} />);
  return { onSubmit, user };
};

const textarea = () => screen.getByRole("textbox", { name: /検索文/ }) as HTMLTextAreaElement;

describe("SearchTextEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("通常は折りたたまれ、開くと Embedding に渡した検索文を表示する", async () => {
    const { user } = renderEditor();

    const details = screen.getByText("Embeddingに使った検索文を確認・編集").closest("details");
    expect(details?.open).toBe(false);

    await user.click(screen.getByText("Embeddingに使った検索文を確認・編集"));

    expect(details?.open).toBe(true);
    expect(textarea().value).toBe(expandedQuery.searchText);
  });

  it("関連語のチェック状態は検索文に含まれるかを表す（大文字小文字は区別しない）", () => {
    renderEditor();

    expect(screen.getByRole("checkbox", { name: "neural network" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Representation Learning" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "graph" })).not.toBeChecked();
  });

  it("関連語を外して再検索すると、その語句を除いた検索文を送る", async () => {
    const { onSubmit, user } = renderEditor();

    await user.click(screen.getByRole("checkbox", { name: "neural network" }));
    expect(textarea().value).toBe("deep learning representation learning");

    await user.click(screen.getByRole("button", { name: "この検索文で再検索" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("deep learning representation learning");
  });

  it("含まれていない関連語にチェックを付けると末尾に追加する", async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole("checkbox", { name: "graph" }));

    expect(textarea().value).toBe(`${expandedQuery.searchText} graph`);
    expect(screen.getByRole("checkbox", { name: "graph" })).toBeChecked();
  });

  it("編集した検索文（前後の空白を除く）で再検索する", async () => {
    const { onSubmit, user } = renderEditor();

    await user.clear(textarea());
    await user.type(textarea(), "  graph neural network  ");
    await user.click(screen.getByRole("button", { name: "この検索文で再検索" }));

    expect(onSubmit).toHaveBeenCalledWith("graph neural network");
  });

  it("検索文が空、または検索中は再検索できない", async () => {
    const { onSubmit, user } = renderEditor();

    await user.clear(textarea());
    expect(screen.getByRole("button", { name: "この検索文で再検索" })).toBeDisabled();

    cleanup();
    renderEditor({ isLoading: true });
    expect(screen.getByRole("button", { name: "この検索文で再検索" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
