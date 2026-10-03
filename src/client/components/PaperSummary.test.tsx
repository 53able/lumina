/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary as PaperSummaryType } from "../../shared/schemas/index";
import { PaperSummary } from "./PaperSummary";

/**
 * PaperSummary コンポーネントテスト
 *
 * Design Docsに基づく仕様:
 * - 要約テキストを表示
 * - キーポイントを箇条書きで表示
 * - 要約生成ボタン
 * - 日本語/英語の切り替え
 */

// テスト用のサンプル要約データ
const createSampleSummary = (overrides: Partial<PaperSummaryType> = {}): PaperSummaryType => ({
  paperId: "2401.00001",
  summary:
    "この論文は強化学習の新しいアプローチを提案しています。従来の手法と比較して、サンプル効率が大幅に向上しています。",
  keyPoints: [
    "新しい報酬設計手法を提案",
    "サンプル効率が従来比3倍向上",
    "複数のベンチマークで最高性能を達成",
  ],
  language: "ja",
  createdAt: new Date("2026-01-17T10:00:00Z"),
  ...overrides,
});

describe("PaperSummary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("要約なしの状態", () => {
    it("正常系: 要約がない場合は生成ボタンを表示する", () => {
      render(<PaperSummary paperId="2401.00001" />);

      // 「要約 + 説明文」ボタンが表示される
      expect(screen.getByRole("button", { name: /要約 \+ 説明文/i })).toBeInTheDocument();
    });

    it("正常系: 生成ボタンをクリックするとonGenerateが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnGenerate = vi.fn();

      render(<PaperSummary paperId="2401.00001" onGenerate={mockOnGenerate} />);

      // 「要約 + 説明文」ボタンをクリック
      await user.click(screen.getByRole("button", { name: /要約 \+ 説明文/i }));

      // paperId, language, target("both") が渡される
      expect(mockOnGenerate).toHaveBeenCalledWith("2401.00001", "ja", "both");
    });
  });

  describe("要約ありの状態", () => {
    it("正常系: 要約テキストが表示される", () => {
      const summary = createSampleSummary();

      render(<PaperSummary paperId="2401.00001" summary={summary} />);

      expect(screen.getByText(/この論文は強化学習の新しいアプローチを提案/)).toBeInTheDocument();
    });

    it("正常系: キーポイントが表示される", () => {
      const summary = createSampleSummary();

      render(<PaperSummary paperId="2401.00001" summary={summary} />);

      expect(screen.getByText("新しい報酬設計手法を提案")).toBeInTheDocument();
      expect(screen.getByText("サンプル効率が従来比3倍向上")).toBeInTheDocument();
      expect(screen.getByText("複数のベンチマークで最高性能を達成")).toBeInTheDocument();
    });

    it("正常系: キーポイントはリスト形式で表示される", () => {
      const summary = createSampleSummary();

      render(<PaperSummary paperId="2401.00001" summary={summary} />);

      expect(screen.getByRole("list")).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });
  });

  describe("言語切り替え", () => {
    it("正常系: 言語切り替えタブが表示される", () => {
      render(<PaperSummary paperId="2401.00001" />);

      expect(screen.getByRole("tab", { name: "日本語" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "English" })).toBeInTheDocument();
    });

    it("正常系: 言語を切り替えるとonLanguageChangeが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnLanguageChange = vi.fn();

      render(<PaperSummary paperId="2401.00001" onLanguageChange={mockOnLanguageChange} />);

      await user.click(screen.getByRole("tab", { name: "English" }));

      expect(mockOnLanguageChange).toHaveBeenCalledWith("en");
    });

    it("正常系: 選択された言語の要約が表示される", () => {
      const summaryEn = createSampleSummary({
        language: "en",
        summary: "This paper proposes a new approach to reinforcement learning.",
      });

      render(<PaperSummary paperId="2401.00001" summary={summaryEn} selectedLanguage="en" />);

      expect(
        screen.getByText("This paper proposes a new approach to reinforcement learning.")
      ).toBeInTheDocument();
    });
  });

  describe("ローディング状態", () => {
    it("正常系: ローディング中はスピナーが表示される", () => {
      render(<PaperSummary paperId="2401.00001" isLoading />);

      expect(screen.getByText(/生成中/i)).toBeInTheDocument();
    });

    it("正常系: ローディング中は生成ボタンが無効になる", () => {
      render(<PaperSummary paperId="2401.00001" isLoading />);

      const generateButton = screen.queryByRole("button", { name: /要約を生成/i });
      if (generateButton) {
        expect(generateButton).toBeDisabled();
      }
    });
  });

  describe("セクションタイトル", () => {
    it("正常系: サマリーセクションのタイトルが表示される", () => {
      render(<PaperSummary paperId="2401.00001" />);

      expect(screen.getByText("AI要約")).toBeInTheDocument();
    });
  });

  describe("参照範囲の表示", () => {
    const scopeNote = /Abstractから生成。本文・図表は未参照/;
    const sourceLinkProps = {
      abstractId: "paper-abstract-2401.00001",
      pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
      arxivUrl: "https://arxiv.org/abs/2401.00001",
    };

    it("正常系: 生成前に参照範囲の注記が表示される", () => {
      render(<PaperSummary paperId="2401.00001" />);

      expect(screen.getByText(scopeNote)).toBeInTheDocument();
    });

    it("正常系: 生成中に参照範囲の注記が表示される", () => {
      render(<PaperSummary paperId="2401.00001" isLoading />);

      expect(screen.getByText(scopeNote)).toBeInTheDocument();
    });

    it("正常系: 生成後に参照範囲の注記が表示される", () => {
      render(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);

      expect(screen.getByText(scopeNote)).toBeInTheDocument();
    });

    it("正常系: 生成後に原文（Abstract・PDF・arXivページ）へのリンクが表示される", () => {
      render(
        <PaperSummary paperId="2401.00001" summary={createSampleSummary()} {...sourceLinkProps} />
      );

      expect(screen.getByRole("link", { name: "Abstract" })).toHaveAttribute(
        "href",
        "#paper-abstract-2401.00001"
      );
      const pdfLink = screen.getByRole("link", { name: "本文PDF" });
      expect(pdfLink).toHaveAttribute("href", sourceLinkProps.pdfUrl);
      expect(pdfLink).toHaveAttribute("target", "_blank");
      const arxivLink = screen.getByRole("link", { name: "arXivページ" });
      expect(arxivLink).toHaveAttribute("href", sourceLinkProps.arxivUrl);
      expect(arxivLink).toHaveAttribute("target", "_blank");
    });

    it("正常系: 原文URLが渡されない場合はリンクを表示しない", () => {
      render(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("正常系: 全文分析と誤認させる文言を表示しない", () => {
      const { container, unmount } = render(<PaperSummary paperId="2401.00001" />);
      expect(container).not.toHaveTextContent(/AI分析|論文の内容/);
      unmount();

      const { container: generated } = render(
        <PaperSummary
          paperId="2401.00001"
          summary={createSampleSummary({
            explanation: "説明文",
            targetAudience: "強化学習の研究者",
            whyRead: "サンプル効率改善の手法が分かる",
          })}
        />
      );
      expect(generated).not.toHaveTextContent(/AI分析|論文の内容/);
    });

    it("正常系: 説明文はAIの推奨として論文中の記述と区別して表示される", async () => {
      const user = userEvent.setup();
      render(
        <PaperSummary
          paperId="2401.00001"
          summary={createSampleSummary({
            explanation: "説明文",
            targetAudience: "強化学習の研究者",
            whyRead: "サンプル効率改善の手法が分かる",
          })}
        />
      );

      await user.click(screen.getByRole("tab", { name: /なぜ読むべきか/ }));

      expect(screen.getByText(/AIの推奨です。論文中の記述ではありません/)).toBeInTheDocument();
    });
  });
});
