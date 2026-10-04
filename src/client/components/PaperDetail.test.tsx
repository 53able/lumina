/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper, PaperSummary } from "../../shared/schemas/index";
import { PaperDetail } from "./PaperDetail";

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
    it("正常系: 論文タイトルが表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      // CardTitleはdivだがタイトルとして表示される
      expect(screen.getByText(mockPaper.title)).toBeInTheDocument();
    });

    it("正常系: 著者が全員表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      // 全著者が表示される（PaperCardは3人で省略するが、Detailは全員）
      for (const author of mockPaper.authors) {
        expect(screen.getByText(new RegExp(author))).toBeInTheDocument();
      }
    });

    it("正常系: アブストラクトが全文表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      // アブストラクトの一部が表示されることを確認
      expect(screen.getByText(/The dominant sequence transduction/)).toBeInTheDocument();
      expect(screen.getByText(/Transformer/)).toBeInTheDocument();
    });

    it("正常系: カテゴリがバッジで表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText("cs.CL")).toBeInTheDocument();
      expect(screen.getByText("cs.LG")).toBeInTheDocument();
    });

    it("正常系: 公開日が表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText(/2024-01-01/)).toBeInTheDocument();
    });

    it("正常系: 更新日が表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText(/2024-01-15/)).toBeInTheDocument();
    });
  });

  describe("リンク", () => {
    it("正常系: PDFへのリンクが表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      const pdfLink = screen.getByRole("link", { name: "PDF" });
      expect(pdfLink).toHaveAttribute("href", mockPaper.pdfUrl);
      expect(pdfLink).toHaveAttribute("target", "_blank");
    });

    it("正常系: arXivページへのリンクが表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      const arxivLink = screen.getByRole("link", { name: "arXiv" });
      expect(arxivLink).toHaveAttribute("href", mockPaper.arxivUrl);
      expect(arxivLink).toHaveAttribute("target", "_blank");
    });
  });

  describe("インタラクション", () => {
    it("正常系: いいねボタンをクリックするとtoggleLikeが呼ばれる", async () => {
      render(<PaperDetail paper={mockPaper} />);

      const user = userEvent.setup();
      const likeButton = screen.getByRole("button", { name: /いいね/i });
      await user.click(likeButton);

      expect(mockToggleLike).toHaveBeenCalledWith(mockPaper.id);
    });

    it("正常系: ブックマークボタンをクリックするとtoggleBookmarkが呼ばれる", async () => {
      render(<PaperDetail paper={mockPaper} />);

      const user = userEvent.setup();
      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      await user.click(bookmarkButton);

      expect(mockToggleBookmark).toHaveBeenCalledWith(mockPaper.id);
    });

    // 閉じるボタンはDialogContentが提供するため、PaperDetailのテスト対象外
  });

  describe("状態表示", () => {
    it("正常系: いいね済み状態が反映される", () => {
      mockLikedPaperIds = new Set([mockPaper.id]);

      render(<PaperDetail paper={mockPaper} />);

      const likeButton = screen.getByRole("button", { name: /いいね/i });
      expect(likeButton).toHaveAttribute("data-liked", "true");
    });

    it("正常系: ブックマーク済み状態が反映される", () => {
      mockBookmarkedPaperIds = new Set([mockPaper.id]);

      render(<PaperDetail paper={mockPaper} />);

      const bookmarkButton = screen.getByRole("button", { name: /ブックマーク/i });
      expect(bookmarkButton).toHaveAttribute("data-bookmarked", "true");
    });
  });

  describe("AI要約機能", () => {
    it("正常系: AI要約セクションが表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText("AI要約")).toBeInTheDocument();
    });

    it("正常系: AI要約の参照範囲注記から原文（Abstract・PDF・arXivページ）へリンクする", () => {
      render(<PaperDetail paper={mockPaper} />);

      expect(screen.getByText(/Abstractから生成。本文・図表は未参照/)).toBeInTheDocument();

      // Abstractリンクのリンク先が、詳細画面に表示されたAbstract本文である
      const abstractLink = screen.getByRole("link", { name: "Abstract" });
      const abstractId = abstractLink.getAttribute("href")?.slice(1) ?? "";
      expect(document.getElementById(abstractId)).toHaveTextContent(mockPaper.abstract);

      expect(screen.getByRole("link", { name: /^本文PDF/ })).toHaveAttribute(
        "href",
        mockPaper.pdfUrl
      );
      expect(screen.getByRole("link", { name: /^arXivページ/ })).toHaveAttribute(
        "href",
        mockPaper.arxivUrl
      );
    });

    it("正常系: 要約生成ボタンが表示される", () => {
      render(<PaperDetail paper={mockPaper} />);

      // 「要約 + 説明文」ボタンが表示される
      expect(screen.getByRole("button", { name: /要約 \+ 説明文/i })).toBeInTheDocument();
    });

    it("正常系: 要約生成ボタンをクリックするとonGenerateSummaryが呼ばれる", async () => {
      const handleGenerateSummary = vi.fn();

      render(<PaperDetail paper={mockPaper} onGenerateSummary={handleGenerateSummary} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /要約 \+ 説明文/i }));

      // paperId, language, target("both") の3引数で呼ばれる
      expect(handleGenerateSummary).toHaveBeenCalledWith(mockPaper.id, "ja", "both");
    });

    it("正常系: 要約がある場合は表示される", () => {
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

  describe("要約の根拠（Abstractの対応箇所）", () => {
    // mockPaper.abstract の文（splitAbstractSentences の分割）
    const sentence1 =
      "The best performing models also connect the encoder and decoder through an attention mechanism.";
    const sentence2 =
      "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.";

    const createSummary = (overrides: Partial<PaperSummary> = {}): PaperSummary => ({
      paperId: mockPaper.id,
      summary: "この論文はTransformerアーキテクチャを提案しています。",
      keyPoints: ["Attention機構のみを使用", "再帰を排除"],
      language: "ja",
      createdAt: new Date(),
      ...overrides,
    });

    let scrollIntoView: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      // jsdom は scrollIntoView を実装しない
      scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it("正常系: 「根拠を見る」の1操作で、Abstractの対応する文を強調してスクロールし、URLと履歴を変えない", async () => {
      const user = userEvent.setup();
      const hrefBefore = window.location.href;
      const historyLengthBefore = window.history.length;
      const { container } = render(
        <PaperDetail
          paper={mockPaper}
          summary={createSummary({
            keyPointEvidence: [[{ index: 2, text: sentence2 }], [{ index: 1, text: sentence1 }]],
          })}
        />
      );
      expect(container.querySelector("mark")).toBeNull();

      await user.click(screen.getByRole("button", { name: "根拠を見る（キーポイント1）" }));

      const marks = container.querySelectorAll("mark");
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent(sentence2);
      expect(marks[0]).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(marks[0]);
      expect(window.location.href).toBe(hrefBefore);
      expect(window.history.length).toBe(historyLengthBefore);
      // 強調してもAbstractの本文は変わらない
      expect(document.getElementById(`paper-abstract-${mockPaper.id}`)).toHaveTextContent(
        mockPaper.abstract
      );

      // 別のキーポイントの根拠に切り替わる
      await user.click(screen.getByRole("button", { name: "根拠を見る（キーポイント2）" }));
      expect(container.querySelector("mark")).toHaveTextContent(sentence1);
    });

    it("正常系: 論文・要約の版・言語を切り替えると、前の根拠の強調を持ち越さない", async () => {
      const user = userEvent.setup();
      const summary = createSummary({
        createdAt: new Date("2026-01-01T00:00:00Z"),
        keyPointEvidence: [[{ index: 2, text: sentence2 }], []],
      });
      const { container, rerender } = render(<PaperDetail paper={mockPaper} summary={summary} />);
      const showEvidence = () =>
        user.click(screen.getByRole("button", { name: "根拠を見る（キーポイント1）" }));

      // 別の版（同じ論文・言語で生成日時が異なる）
      await showEvidence();
      expect(container.querySelector("mark")).not.toBeNull();
      rerender(
        <PaperDetail
          paper={mockPaper}
          summary={{ ...summary, createdAt: new Date("2026-01-02T00:00:00Z") }}
        />
      );
      expect(container.querySelector("mark")).toBeNull();

      // 言語の切替
      rerender(<PaperDetail paper={mockPaper} summary={summary} />);
      await showEvidence();
      expect(container.querySelector("mark")).not.toBeNull();
      rerender(<PaperDetail paper={mockPaper} summary={summary} selectedSummaryLanguage="en" />);
      expect(container.querySelector("mark")).toBeNull();

      // 論文の差し替え（同じ Abstract でも別の論文なら強調しない）
      rerender(<PaperDetail paper={mockPaper} summary={summary} />);
      await showEvidence();
      expect(container.querySelector("mark")).not.toBeNull();
      rerender(
        <PaperDetail
          paper={{ ...mockPaper, id: "2401.00002" }}
          summary={{ ...summary, paperId: "2401.00002" }}
        />
      );
      expect(container.querySelector("mark")).toBeNull();
    });

    it("異常系: Abstractに実在しない根拠（範囲外の番号・文の不一致）は根拠として示さず「対応箇所未確認」にする", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <PaperDetail
          paper={mockPaper}
          summary={createSummary({
            keyPointEvidence: [
              [{ index: 9, text: "Fabricated sentence that is not in the abstract." }],
              [{ index: 1, text: "Fabricated sentence that is not in the abstract." }],
            ],
          })}
        />
      );

      expect(screen.queryByRole("button", { name: /^根拠を見る/ })).not.toBeInTheDocument();
      expect(screen.getAllByText(/対応箇所未確認/)).toHaveLength(2);
      expect(container).not.toHaveTextContent("Fabricated sentence");

      // 未確認でも原文へ進める（強調はしない）
      await user.click(
        screen.getByRole("button", { name: "Abstractを見る（キーポイント1は対応箇所未確認）" })
      );
      const abstract = document.getElementById(`paper-abstract-${mockPaper.id}`);
      expect(scrollIntoView.mock.contexts[0]).toBe(abstract);
      expect(abstract).toHaveFocus();
      expect(container.querySelector("mark")).toBeNull();
    });

    it("正常系: 根拠情報のない古い保存済み要約でも壊れず、全キーポイントを「対応箇所未確認」として原文へ進める", async () => {
      const user = userEvent.setup();
      render(<PaperDetail paper={mockPaper} summary={createSummary()} />);

      expect(screen.getByText("Attention機構のみを使用")).toBeInTheDocument();
      expect(screen.getAllByText(/対応箇所未確認/)).toHaveLength(2);

      await user.click(
        screen.getByRole("button", { name: "Abstractを見る（キーポイント2は対応箇所未確認）" })
      );
      expect(document.getElementById(`paper-abstract-${mockPaper.id}`)).toHaveFocus();
    });

    it("正常系: 根拠は対応する文の提示であり、要点の正しさの保証や確率として表示しない", () => {
      const { container } = render(
        <PaperDetail
          paper={mockPaper}
          summary={createSummary({
            keyPointEvidence: [[{ index: 2, text: sentence2 }], []],
          })}
        />
      );

      expect(screen.getByText(/要点が正しいことの保証ではない/)).toBeInTheDocument();
      // 根拠のある項目と未確認の項目を区別する
      expect(
        screen.getByRole("button", { name: "根拠を見る（キーポイント1）" })
      ).toBeInTheDocument();
      expect(screen.getAllByText(/対応箇所未確認/)).toHaveLength(1);
      // 類似度・一致率を正確性の確率のように見せない
      expect(container).not.toHaveTextContent(/%|％|確率|信頼度|一致率|類似度/);
    });
  });
});
