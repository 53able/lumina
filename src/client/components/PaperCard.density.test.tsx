/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { PaperCard } from "./PaperCard";

vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteraction: () => ({
    isLiked: false,
    isBookmarked: false,
    toggleLike: vi.fn(),
    toggleBookmark: vi.fn(),
  }),
}));

/**
 * PaperCard の選別に必要な情報（#68）
 *
 * - タイトルは省略せず全文を表示する（詳細を開かずに読む対象を選べる）
 * - Abstract の抜粋（原文）を表示し、AI が生成した文とラベルで区別する
 */

const LONG_TITLE =
  "A Very Long Paper Title That Would Previously Have Been Truncated After Two Lines In The Card Layout Of The Paper List";

const paper: Paper = {
  id: "2401.00001",
  title: LONG_TITLE,
  abstract:
    "We study how retrieval quality changes when queries are rewritten by a language model.",
  authors: ["Alice Smith"],
  categories: ["cs.CL"],
  publishedAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-16"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
};

const WHY_READ = "クエリ書き換えの効果を定量的に把握できる";

describe("PaperCard の選別に必要な情報（#68）", () => {
  afterEach(() => {
    cleanup();
  });

  it("タイトルは行数で省略しない", () => {
    render(
      <MemoryRouter>
        <PaperCard paper={paper} />
      </MemoryRouter>
    );

    const title = screen.getByText(LONG_TITLE);
    expect(title.className).not.toMatch(/line-clamp|truncate/);
  });

  it("Abstract の抜粋を「原文」のラベル付きで表示し、AI が生成した文とは別の要素にする", () => {
    render(
      <MemoryRouter>
        <PaperCard paper={paper} whyRead={WHY_READ} />
      </MemoryRouter>
    );

    const excerpt = screen.getByTestId("abstract-excerpt");
    expect(excerpt).toHaveTextContent("Abstract（原文）");
    expect(excerpt).toHaveTextContent(paper.abstract);
    expect(excerpt).not.toHaveTextContent(WHY_READ);

    // AI が生成した文（whyRead）は抜粋の外にあり、原文のラベルを持たない
    const whyRead = screen.getByText(WHY_READ);
    expect(excerpt.contains(whyRead)).toBe(false);
    expect(whyRead.parentElement).not.toHaveTextContent("原文");
  });

  it("Abstract が空なら抜粋を出さない", () => {
    render(
      <MemoryRouter>
        <PaperCard paper={{ ...paper, abstract: "" }} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("abstract-excerpt")).not.toBeInTheDocument();
  });
});
