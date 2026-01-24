/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas";

// InteractionContextをモック
const mockToggleLike = vi.fn();
const mockToggleBookmark = vi.fn();
let mockLikedPaperIds = new Set<string>();
let mockBookmarkedPaperIds = new Set<string>();

vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteraction: (paperId: string) => ({
    isLiked: mockLikedPaperIds.has(paperId),
    isBookmarked: mockBookmarkedPaperIds.has(paperId),
    toggleLike: () => mockToggleLike(paperId),
    toggleBookmark: () => mockToggleBookmark(paperId),
  }),
}));

// モック用の論文データ
const mockPaper: Paper = {
  id: "2401.00001",
  title: "Attention Is All You Need",
  abstract:
    "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones"],
  categories: ["cs.CL", "cs.LG"],
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-15"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
};

/**
 * PaperDetail テスト
 *
 * Design Docsに基づく仕様:
 * - 論文の詳細情報（タイトル、著者全員、アブストラクト全文）
 * - カテゴリ、公開日、更新日
 * - PDF/arXivへのリンク
 * - いいね/ブックマークボタン
 * - 閉じるボタンはDialogContentが提供するため、PaperDetailには含まない
 */
describe("PaperDetail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockLikedPaperIds = new Set<string>();
    mockBookmarkedPaperIds = new Set<string>();
  });

  describe("論文情報の表示", () => {
    it("正常系: 論文タイトルが表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      // CardTitleはdivだがタイトルとして表示される
      expect(screen.getByText(mockPaper.title)).toBeInTheDocument();
    });

    it("正常系: 著者が全員表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      // 全著者が表示される（PaperCardは3人で省略するが、Detailは全員）
      for (const author of mockPaper.authors) {
        expect(screen.getByText(new RegExp(author))).toBeInTheDocument();
      }
    });

    it("正常系: アブストラクトが全文表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      // アブストラクトの一部が表示されることを確認
      expect(screen.getByText(/The dominant sequence transduction/)).toBeInTheDocument();
      expect(screen.getByText(/Transformer/)).toBeInTheDocument();
    });

    it("正常系: カテゴリがバッジで表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText("cs.CL")).toBeInTheDocument();
      expect(screen.getByText("cs.LG")).toBeInTheDocument();
    });

    it("正常系: 公開日が表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText(/2024-01-01/)).toBeInTheDocument();
    });

    it("正常系: 更新日が表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText(/2024-01-15/)).toBeInTheDocument();
    });
  });

  describe("リンク", () => {
    it("正常系: PDFへのリンクが表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      const pdfLink = screen.getByRole("link", { name: /PDF/i });
      expect(pdfLink).toHaveAttribute("href", mockPaper.pdfUrl);
      expect(pdfLink).toHaveAttribute("target", "_blank");
    });

    it("正常系: arXivページへのリンクが表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      const arxivLink = screen.getByRole("link", { name: /arXiv/i });
      expect(arxivLink).toHaveAttribute("href", mockPaper.arxivUrl);
      expect(arxivLink).toHaveAttribute("target", "_blank");
    });
  });

  describe("インタラクション", () => {
    it("正常系: いいねボタンをクリックするとtoggleLikeが呼ばれる", async () => {
      const { PaperDetail } = await import("./PaperDetail");

      render(<PaperDetail paper={mockPaper} />);

      const user = userEvent.setup();
      const likeButton = screen.getByRole("button", { name: /いいね/i });
      await user.click(likeButton);

      expect(mockToggleLike).toHaveBeenCalledWith(mockPaper.id);
    });

    it("正常系: ブックマークボタンをクリックするとtoggleBookmarkが呼ばれる", async () => {
      const { PaperDetail } = await import("./PaperDetail");

      render(<PaperDetail paper={mockPaper} />);

      const user = userEvent.setup();
      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      await user.click(bookmarkButton);

      expect(mockToggleBookmark).toHaveBeenCalledWith(mockPaper.id);
    });

    // 閉じるボタンはDialogContentが提供するため、PaperDetailのテスト対象外
  });

  describe("状態表示", () => {
    it("正常系: いいね済み状態が反映される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      mockLikedPaperIds = new Set([mockPaper.id]);

      render(<PaperDetail paper={mockPaper} />);

      const likeButton = screen.getByRole("button", { name: /いいね/i });
      expect(likeButton).toHaveAttribute("data-liked", "true");
    });

    it("正常系: ブックマーク済み状態が反映される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      mockBookmarkedPaperIds = new Set([mockPaper.id]);

      render(<PaperDetail paper={mockPaper} />);

      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      expect(bookmarkButton).toHaveAttribute("data-bookmarked", "true");
    });
  });

  describe("AI要約機能", () => {
    it("正常系: AI要約セクションが表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      // セクションタイトルは「AI分析」に変更
      expect(screen.getByText("AI分析")).toBeInTheDocument();
    });

    it("正常系: 要約生成ボタンが表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      render(<PaperDetail paper={mockPaper} />);

      // 「要約のみ」と「要約 + 説明文」の2つのボタンが表示される
      expect(screen.getByRole("button", { name: /要約のみ/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /要約 \+ 説明文/i })).toBeInTheDocument();
    });

    it("正常系: 要約生成ボタンをクリックするとonGenerateSummaryが呼ばれる", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      const handleGenerateSummary = vi.fn();

      render(<PaperDetail paper={mockPaper} onGenerateSummary={handleGenerateSummary} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /要約 \+ 説明文/i }));

      // paperId, language, target("both") の3引数で呼ばれる
      expect(handleGenerateSummary).toHaveBeenCalledWith(mockPaper.id, "ja", "both");
    });

    it("正常系: 要約がある場合は表示される", async () => {
      const { PaperDetail } = await import("./PaperDetail");
      const mockSummary = {
        paperId: mockPaper.id,
        summary: "この論文はTransformerアーキテクチャを提案しています。",
        keyPoints: ["Attention機構のみを使用", "再帰を排除"],
        language: "ja" as const,
        createdAt: new Date(),
      };

      render(<PaperDetail paper={mockPaper} summary={mockSummary} />);

      expect(
        screen.getByText("この論文はTransformerアーキテクチャを提案しています。")
      ).toBeInTheDocument();
    });
  });
});
