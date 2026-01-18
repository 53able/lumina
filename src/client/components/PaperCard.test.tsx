/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/shared/schemas";

/**
 * MemoryRouterでラップしたレンダリングヘルパー
 */
const renderWithRouter = (ui: ReactNode) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

/**
 * PaperCard テスト
 *
 * Design Docsに基づく仕様:
 * - 論文タイトルの表示
 * - 著者の表示
 * - カテゴリバッジの表示
 * - 公開日の表示
 * - いいね/ブックマークボタン
 */

// テスト用のサンプル論文データ
const createSamplePaper = (overrides: Partial<Paper> = {}): Paper => ({
  id: "2401.00001",
  title: "Sample Paper: A Novel Approach to Machine Learning",
  abstract: "This paper presents a novel approach to machine learning...",
  authors: ["Alice Smith", "Bob Johnson", "Carol Williams"],
  categories: ["cs.AI", "cs.LG"],
  publishedAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-16"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  ...overrides,
});

describe("PaperCard", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 論文タイトルが表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} />);

      expect(screen.getByText(/Sample Paper: A Novel Approach/i)).toBeInTheDocument();
    });

    it("正常系: 著者が表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} />);

      expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
    });

    it("正常系: カテゴリバッジが表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} />);

      expect(screen.getByText("cs.AI")).toBeInTheDocument();
      expect(screen.getByText("cs.LG")).toBeInTheDocument();
    });

    it("正常系: 公開日が表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} />);

      // 日付のフォーマットに応じてテスト
      expect(screen.getByText(/2024/)).toBeInTheDocument();
    });
  });

  describe("インタラクション", () => {
    it("正常系: クリックでonClickが呼ばれる", async () => {
      const { PaperCard } = await import("./PaperCard");
      const user = userEvent.setup();
      const paper = createSamplePaper();
      const handleClick = vi.fn();

      renderWithRouter(<PaperCard paper={paper} onClick={handleClick} />);

      // カード全体をクリック
      const card = screen.getByRole("article");
      await user.click(card);

      expect(handleClick).toHaveBeenCalledWith(paper);
    });

    it("正常系: いいねボタンクリックでonLikeが呼ばれる", async () => {
      const { PaperCard } = await import("./PaperCard");
      const user = userEvent.setup();
      const paper = createSamplePaper();
      const handleLike = vi.fn();

      renderWithRouter(<PaperCard paper={paper} onLike={handleLike} />);

      const likeButton = screen.getByRole("button", { name: /いいね/i });
      await user.click(likeButton);

      expect(handleLike).toHaveBeenCalledWith(paper.id);
    });

    it("正常系: ブックマークボタンクリックでonBookmarkが呼ばれる", async () => {
      const { PaperCard } = await import("./PaperCard");
      const user = userEvent.setup();
      const paper = createSamplePaper();
      const handleBookmark = vi.fn();

      renderWithRouter(<PaperCard paper={paper} onBookmark={handleBookmark} />);

      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      await user.click(bookmarkButton);

      expect(handleBookmark).toHaveBeenCalledWith(paper.id);
    });
  });

  describe("状態表示", () => {
    it("正常系: いいね済みの状態が表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} isLiked />);

      const likeButton = screen.getByRole("button", { name: /いいね/i });
      expect(likeButton).toHaveAttribute("data-liked", "true");
    });

    it("正常系: ブックマーク済みの状態が表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} isBookmarked />);

      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      expect(bookmarkButton).toHaveAttribute("data-bookmarked", "true");
    });
  });

  describe("whyRead表示", () => {
    it("正常系: whyReadが指定された場合に表示される", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();
      const whyRead = "機械学習モデルの効率的な学習方法を理解できます";

      renderWithRouter(<PaperCard paper={paper} whyRead={whyRead} />);

      expect(screen.getByText(whyRead)).toBeInTheDocument();
    });

    it("正常系: whyReadが未指定の場合は表示されない", async () => {
      const { PaperCard } = await import("./PaperCard");
      const paper = createSamplePaper();

      renderWithRouter(<PaperCard paper={paper} />);

      // whyRead用のテキストが存在しないことを確認（タイトルと著者以外に説明文がないこと）
      const cards = screen.getAllByText(/./);
      const whyReadPattern = /得られ|理解|学べ/;
      const hasWhyReadText = cards.some((el) => whyReadPattern.test(el.textContent ?? ""));
      expect(hasWhyReadText).toBe(false);
    });
  });
});
