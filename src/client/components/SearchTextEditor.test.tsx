/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpandedQuery } from "../../shared/schemas/index";
import { useSettingsStore } from "../stores/settingsStore";
import { SearchTextEditor } from "./SearchTextEditor";

/**
 * SearchTextEditor テスト（#31）
 *
 * - Embedding に渡した検索文を折りたたみ詳細で確認できる
 * - 検索文の編集・関連語の除外をして再検索できる（送るのは表示中の検索文）
 * - 関連語は単語境界つきの完全一致で扱い、英訳の内側の語は除外しない
 * - 編集済みの検索は「元の検索文に戻す」で編集前の文を編集欄に戻せる
 * - API利用OFF中は再検索できず、理由をボタンの説明として伝える
 */

const expandedQuery: ExpandedQuery = {
  original: "深層学習",
  english: "deep learning",
  synonyms: ["neural network", "Representation Learning", "graph", "graph"],
  searchText: "deep learning neural network representation learning",
};

const renderEditor = ({
  isLoading,
  query = expandedQuery,
}: {
  isLoading?: boolean;
  query?: ExpandedQuery;
} = {}) => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<SearchTextEditor expandedQuery={query} onSubmit={onSubmit} isLoading={isLoading} />);
  return { onSubmit, user };
};

const submitButton = () => screen.getByRole("button", { name: "この検索文で再検索" });

const textarea = () => screen.getByRole("textbox", { name: /検索文/ }) as HTMLTextAreaElement;

describe("SearchTextEditor", () => {
  beforeEach(() => {
    useSettingsStore.setState({ apiEnabled: true });
  });

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
    // 重複して返った関連語は1つにまとめる
    expect(screen.getAllByRole("checkbox", { name: "graph" })).toHaveLength(1);
  });

  it("関連語の一部を含む語（RL と world・curl）や複数形はチェック扱いにせず、除外でも消さない", async () => {
    const { user } = renderEditor({
      query: {
        original: "強化学習",
        english: "reinforcement learning",
        synonyms: ["RL", "neural network"],
        searchText: "reinforcement learning real world curl neural networks RL",
      },
    });

    expect(screen.getByRole("checkbox", { name: "neural network" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "RL" }));

    expect(textarea().value).toBe("reinforcement learning real world curl neural networks");
  });

  it("英訳の内側にある語は関連語として扱わず、除外しても英訳を壊さない", async () => {
    const { user } = renderEditor({
      query: {
        original: "深層学習",
        english: "deep learning",
        synonyms: ["learning"],
        searchText: "deep learning representation learning",
      },
    });

    await user.click(screen.getByRole("checkbox", { name: "learning" }));

    expect(textarea().value).toBe("deep learning representation");
    expect(screen.getByRole("checkbox", { name: "learning" })).not.toBeChecked();
  });

  it("関連語を外して再検索すると、その語句を除いた検索文を送る", async () => {
    const { onSubmit, user } = renderEditor();

    await user.click(screen.getByRole("checkbox", { name: "neural network" }));
    expect(textarea().value).toBe("deep learning representation learning");

    await user.click(submitButton());

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
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith("graph neural network");
  });

  it("検索文が空、または検索中は再検索できない", async () => {
    const { onSubmit, user } = renderEditor();

    await user.clear(textarea());
    expect(submitButton()).toBeDisabled();

    cleanup();
    renderEditor({ isLoading: true });
    expect(submitButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("編集済みの検索は開いた状態で表示し、「元の検索文に戻す」で編集前の文を編集欄に戻す", async () => {
    const { onSubmit, user } = renderEditor({
      query: {
        ...expandedQuery,
        searchText: "deep learning",
        originalSearchText: expandedQuery.searchText,
      },
    });

    expect(textarea().closest("details")?.open).toBe(true);
    await user.click(screen.getByRole("button", { name: "元の検索文に戻す" }));

    expect(textarea().value).toBe(expandedQuery.searchText);
    expect(screen.queryByRole("button", { name: "元の検索文に戻す" })).not.toBeInTheDocument();
    // 編集欄に戻すだけで、再検索は利用者が実行する
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("編集していない検索では「元の検索文に戻す」を出さない", () => {
    renderEditor();

    expect(screen.queryByRole("button", { name: "元の検索文に戻す" })).not.toBeInTheDocument();
  });

  it("API利用OFF中は再検索ボタンを無効にし、理由をボタンの説明として伝える", () => {
    useSettingsStore.setState({ apiEnabled: false });
    renderEditor();

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription(/API利用OFFのため再検索を停止中/);
  });
});
