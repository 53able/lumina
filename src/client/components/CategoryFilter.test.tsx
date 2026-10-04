/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryFilter } from "./CategoryFilter";

/**
 * CategoryFilter（#68）
 *
 * - コードと日本語の分野名を併記する
 * - カテゴリが多いときは、全件をスクロールしなくても名前・コードで探して選べる
 * - 選択状態を aria-pressed で伝え、フォーカスを見えるようにする
 */

const MANY_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.IR", "cs.LG", "cs.RO", "stat.ML"];

const renderFilter = (availableCategories: string[], selected: string[] = []) => {
  const onToggle = vi.fn();
  render(
    <CategoryFilter
      availableCategories={availableCategories}
      selectedCategories={new Set(selected)}
      onToggle={onToggle}
      hideLabel
    />
  );
  const group = screen.getByRole("group", { name: "カテゴリで絞り込み" });
  return { onToggle, group };
};

describe("CategoryFilter", () => {
  afterEach(() => {
    cleanup();
  });

  it("各カテゴリをコードと日本語の分野名で表示し、選択状態を aria-pressed で伝える", () => {
    const { group } = renderFilter(["cs.CL", "cs.LG"], ["cs.LG"]);

    expect(within(group).getByRole("button", { name: "cs.CL 自然言語処理" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(within(group).getByRole("button", { name: "cs.LG 機械学習" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("フォーカス時に枠を表示する（フォーカスの見た目を消さない）", () => {
    const { group } = renderFilter(["cs.CL", "cs.LG"]);

    const button = within(group).getByRole("button", { name: /^cs\.CL / });
    expect(button.className).toContain("focus-visible:ring-2");
    expect(button.className).not.toMatch(/(^|\s)focus:outline-none/);
  });

  it("カテゴリが少ないときは探す欄を出さない", () => {
    renderFilter(["cs.CL", "cs.LG"]);

    expect(
      screen.queryByRole("textbox", { name: "カテゴリを分野名・コードで探す" })
    ).not.toBeInTheDocument();
  });

  it("日本語の分野名で探して選べる", async () => {
    const user = userEvent.setup({ delay: null });
    const { onToggle, group } = renderFilter(MANY_CATEGORIES);

    await user.type(
      within(group).getByRole("textbox", { name: "カテゴリを分野名・コードで探す" }),
      "機械学習"
    );

    // 名前に「機械学習」を含むもの（cs.LG・stat.ML）だけが残る
    expect(within(group).getAllByRole("button", { pressed: false })).toHaveLength(2);
    expect(within(group).getByRole("button", { name: /^cs\.LG / })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /^stat\.ML / })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: /^cs\.CV / })).not.toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: /^cs\.LG / }));
    expect(onToggle).toHaveBeenCalledWith("cs.LG");
  });

  it("コードで探せる（大文字小文字を区別しない）", async () => {
    const user = userEvent.setup({ delay: null });
    const { group } = renderFilter(MANY_CATEGORIES);

    await user.type(within(group).getByRole("textbox"), "cs.ro");

    expect(within(group).getAllByRole("button")).toHaveLength(1);
    expect(within(group).getByRole("button", { name: "cs.RO ロボティクス" })).toBeInTheDocument();
  });

  it("一致しないときはその旨を表示する", async () => {
    const user = userEvent.setup({ delay: null });
    const { group } = renderFilter(MANY_CATEGORIES);

    await user.type(within(group).getByRole("textbox"), "天文学");

    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    expect(within(group).getByText("「天文学」に一致するカテゴリはありません")).toBeInTheDocument();
  });
});
