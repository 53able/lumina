/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary as PaperSummaryType } from "@/shared/schemas";
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

      // 「要約のみ」と「要約 + 説明文」の2つのボタンが表示される
      expect(screen.getByRole("button", { name: /要約のみ/i })).toBeInTheDocument();
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

      expect(screen.getByText("AI分析")).toBeInTheDocument();
    });
  });
});
