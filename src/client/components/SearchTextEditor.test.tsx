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
 * SearchTextEditor テスト（#31, #72）
 *
 * - 入力・AIの英訳・AIが作った検索文・関連語・検索に使う文を区別して表示する
 * - 初期状態は AIが作った検索文をそのまま使い、関連語はすべてチェック済み
 * - 関連語のチェックを変えると「英訳 + チェックした関連語」から検索文を作り直し、外した語を再追加しない
 * - 直接編集で選択と異なる文にすると「自由編集中（関連語の選択は無効）」と示し、選択に戻せる
 * - 再検索で送るのは常に「検索に使う文」に表示した文
 * - API利用OFF中は再検索できず、理由をボタンの説明として伝える
 */

/** AIが作った検索文は関連語を言い換えて含む（関連語と完全一致しない） */
const expandedQuery: ExpandedQuery = {
  original: "深層学習",
  english: "deep learning",
  synonyms: ["neural networks", "Representation Learning", "graph", "Graph"],
  searchText: "deep learning neural network representation learning methods",
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

const SUMMARY = "AIが検索に使った言葉を確認・調整";
const FREE_EDITING = /自由編集中（関連語の選択は無効）/;

const submitButton = () => screen.getByRole("button", { name: "この検索文で再検索" });
const textarea = () =>
  screen.getByRole("textbox", { name: "検索文を直接編集" }) as HTMLTextAreaElement;
const finalText = () => screen.getByRole("status", { name: /^検索に使う文/ }).textContent;
/** 状態の説明（名前のない status。「検索に使う文」とは別） */
const modeStatus = () =>
  screen.getAllByRole("status").find((el) => !el.hasAttribute("aria-labelledby")) as HTMLElement;
const checkbox = (name: string) => screen.getByRole("checkbox", { name });

describe("SearchTextEditor", () => {
  beforeEach(() => {
    useSettingsStore.setState({ apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("通常は折りたたまれ、開くと入力・AIの英訳・AIが作った検索文・検索に使う文を区別して表示する", async () => {
    const { user } = renderEditor();

    const details = screen.getByText(SUMMARY).closest("details");
    expect(details?.open).toBe(false);
    await user.click(screen.getByText(SUMMARY));
    expect(details?.open).toBe(true);

    const terms = screen.getAllByRole("term").map((el) => el.textContent);
    const definitions = screen.getAllByRole("definition").map((el) => el.textContent);
    expect(terms).toEqual(["あなたの入力", "AIの英訳", "AIが作った検索文"]);
    expect(definitions).toEqual(["深層学習", "deep learning", expandedQuery.searchText]);
    expect(screen.getByRole("group", { name: /AIが追加した関連語/ })).toBeInTheDocument();
    expect(finalText()).toBe(expandedQuery.searchText);
  });

  it("初期状態はAIが作った検索文をそのまま使い、関連語が完全一致しなくてもすべてチェック済みにする", () => {
    renderEditor();

    // AIの検索文は "neural network"（単数）だが、関連語 "neural networks" を未選択や除外と表示しない
    expect(checkbox("neural networks")).toBeChecked();
    expect(checkbox("Representation Learning")).toBeChecked();
    expect(checkbox("graph")).toBeChecked();
    // 重複して返った関連語は大文字小文字を区別せず1つにまとめる
    expect(screen.getAllByRole("checkbox", { name: /^graph$/i })).toHaveLength(1);
    expect(modeStatus()).toHaveTextContent(/AIが作った検索文をそのまま使います/);
    expect(textarea().value).toBe(expandedQuery.searchText);
  });

  it("関連語のチェックを外すと英訳とチェックした関連語から作り直し、その文を送る", async () => {
    const { onSubmit, user } = renderEditor();

    await user.click(checkbox("graph"));

    expect(finalText()).toBe("deep learning neural networks Representation Learning");
    expect(textarea().value).toBe("deep learning neural networks Representation Learning");
    expect(modeStatus()).toHaveTextContent(/英訳とチェックした関連語から作った検索文を使います/);
    expect(screen.queryByText(FREE_EDITING)).not.toBeInTheDocument();

    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("deep learning neural networks Representation Learning");
  });

  it("外した関連語は他の語を操作しても再追加せず、付け直すと関連語の順で戻す", async () => {
    const { user } = renderEditor();

    await user.click(checkbox("neural networks"));
    await user.click(checkbox("graph"));
    expect(finalText()).toBe("deep learning Representation Learning");

    await user.click(checkbox("Representation Learning"));
    expect(finalText()).toBe("deep learning");
    expect(checkbox("neural networks")).not.toBeChecked();

    // 付け直す順に関係なく、関連語の並び順で検索文を作る（語順の違いで状態が変わらない）
    await user.click(checkbox("graph"));
    await user.click(checkbox("neural networks"));
    expect(finalText()).toBe("deep learning neural networks graph");
  });

  it("直接編集で選択と異なる文にすると自由編集中と示し、関連語の選択を無効にする", async () => {
    const { onSubmit, user } = renderEditor();

    await user.click(checkbox("graph"));
    await user.type(textarea(), " extra");

    expect(modeStatus()).toHaveTextContent(FREE_EDITING);
    expect(screen.getByRole("group", { name: /AIが追加した関連語/ })).toBeDisabled();
    expect(finalText()).toBe("deep learning neural networks Representation Learning extra");
    expect(screen.getByText("検索に使う文（手動で編集）")).toBeInTheDocument();

    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith(
      "deep learning neural networks Representation Learning extra"
    );
  });

  it("自由編集で関連語を部分一致する形（複数形の削除）に変えても、チェック状態を書き換えない", async () => {
    const { user } = renderEditor();

    await user.click(checkbox("graph"));
    await user.clear(textarea());
    await user.type(textarea(), "deep learning neural network");

    expect(modeStatus()).toHaveTextContent(FREE_EDITING);
    // 部分一致から「除いた」とは推測しない（選択は自由編集前のまま、無効表示）
    expect(checkbox("neural networks")).toBeChecked();
    expect(checkbox("Representation Learning")).toBeChecked();
    expect(checkbox("graph")).not.toBeChecked();
  });

  it("自由編集を選択から作る文と同じに戻すと、自由編集中の表示を消す", async () => {
    const { user } = renderEditor();

    await user.click(checkbox("graph"));
    await user.type(textarea(), "x");
    expect(modeStatus()).toHaveTextContent(FREE_EDITING);
    await user.type(textarea(), "{Backspace}");

    expect(screen.queryByText(FREE_EDITING)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /AIが追加した関連語/ })).toBeEnabled();
  });

  it("「関連語の選択に戻す」で自由編集をやめ、直前の選択から作った文に戻す", async () => {
    const { onSubmit, user } = renderEditor();

    await user.click(checkbox("graph"));
    await user.type(textarea(), " extra");
    await user.click(screen.getByRole("button", { name: "関連語の選択に戻す" }));

    expect(finalText()).toBe("deep learning neural networks Representation Learning");
    expect(screen.queryByText(FREE_EDITING)).not.toBeInTheDocument();
    expect(checkbox("graph")).not.toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("「AIが作った検索文に戻す」で選択も初期状態に戻す", async () => {
    const { user } = renderEditor();

    expect(
      screen.queryByRole("button", { name: "AIが作った検索文に戻す" })
    ).not.toBeInTheDocument();
    await user.click(checkbox("graph"));
    await user.click(screen.getByRole("button", { name: "AIが作った検索文に戻す" }));

    expect(finalText()).toBe(expandedQuery.searchText);
    expect(checkbox("graph")).toBeChecked();
    expect(
      screen.queryByRole("button", { name: "AIが作った検索文に戻す" })
    ).not.toBeInTheDocument();
  });

  it("関連語の選択で再検索した検索は、開いた状態で同じ選択を復元する", () => {
    renderEditor({
      query: {
        ...expandedQuery,
        searchText: "deep learning neural networks graph",
        originalSearchText: expandedQuery.searchText,
      },
    });

    expect(screen.getByText(SUMMARY).closest("details")?.open).toBe(true);
    expect(checkbox("neural networks")).toBeChecked();
    expect(checkbox("Representation Learning")).not.toBeChecked();
    expect(checkbox("graph")).toBeChecked();
    expect(screen.queryByText(FREE_EDITING)).not.toBeInTheDocument();
    // AIが作った検索文（元の文）も区別して残す
    expect(screen.getAllByRole("definition")[2]).toHaveTextContent(expandedQuery.searchText);
  });

  it("自由編集で再検索した検索は、手動修正を保ったまま自由編集中として開く", async () => {
    const { onSubmit, user } = renderEditor({
      query: {
        ...expandedQuery,
        // 語順を入れ替えた文は選択の形ではない
        searchText: "deep learning graph neural networks",
        originalSearchText: expandedQuery.searchText,
      },
    });

    expect(modeStatus()).toHaveTextContent(FREE_EDITING);
    expect(finalText()).toBe("deep learning graph neural networks");
    expect(textarea().closest("details")?.open).toBe(true);
    // 戻せる選択はないので「AIが作った検索文に戻す」だけを出す
    expect(screen.queryByRole("button", { name: "関連語の選択に戻す" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AIが作った検索文に戻す" })).toBeInTheDocument();

    await user.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith("deep learning graph neural networks");
  });

  it("関連語の見出しは状態に応じてチェックの意味を説明する", async () => {
    const { user } = renderEditor();
    const group = () => screen.getByRole("group", { name: /AIが追加した関連語/ });

    // 初期状態はAIの文をそのまま送るので「チェックした語を含める」とは言わない
    expect(group()).toHaveAccessibleName(
      "AIが追加した関連語（チェックを変えると、英訳と選んだ語から検索文を作り直します）"
    );
    await user.click(checkbox("graph"));
    expect(group()).toHaveAccessibleName("AIが追加した関連語（チェックした語を検索に含めます）");
    await user.type(textarea(), " extra");
    expect(group()).toHaveAccessibleName("AIが追加した関連語（自由編集中のため選択は無効）");
  });

  it("「検索に使う文」は入力のたびに読み上げない（aria-live=off）、状態の説明だけを読み上げる", () => {
    renderEditor();

    expect(screen.getByRole("status", { name: /^検索に使う文/ })).toHaveAttribute(
      "aria-live",
      "off"
    );
    expect(modeStatus()).not.toHaveAttribute("aria-live");
    expect(modeStatus().tagName).toBe("OUTPUT");
  });

  it("直接編集欄の名前は「検索文を直接編集」で、補足と状態を説明として伝える", () => {
    renderEditor();

    expect(textarea()).toHaveAccessibleName("検索文を直接編集");
    expect(textarea()).toHaveAccessibleDescription(/編集すると関連語の選択は無効になります/);
    expect(textarea()).toHaveAccessibleDescription(/AIが作った検索文をそのまま使います/);
  });

  it("選択を経ずに自由編集した場合は「関連語の選択に戻す」を出さず、AIが作った検索文に戻す", async () => {
    const { user } = renderEditor();

    await user.type(textarea(), " extra");
    expect(modeStatus()).toHaveTextContent(FREE_EDITING);
    expect(modeStatus()).toHaveTextContent("「AIが作った検索文に戻す」を押してください");
    expect(screen.queryByRole("button", { name: "関連語の選択に戻す" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AIが作った検索文に戻す" }));
    expect(finalText()).toBe(expandedQuery.searchText);
    expect(screen.queryByText(FREE_EDITING)).not.toBeInTheDocument();
  });

  it("直接編集した検索文（前後の空白を除く）で再検索する", async () => {
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

  it("API利用OFF中は再検索ボタンを無効にし、理由をボタンの説明として伝える", () => {
    useSettingsStore.setState({ apiEnabled: false });
    renderEditor();

    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription(/API利用OFFのため再検索を停止中/);
  });
});
