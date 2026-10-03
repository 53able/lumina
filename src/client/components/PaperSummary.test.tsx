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

  describe("生成状態の通知", () => {
    it("正常系: 生成開始と完了を status で通知し、要約本文は読み上げ対象に含めない", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" />);
      const status = screen.getByRole("status");
      expect(status).toBeEmptyDOMElement();

      rerender(<PaperSummary paperId="2401.00001" isLoading />);
      expect(status).toHaveTextContent("要約を生成しています");

      const summary = createSampleSummary();
      rerender(<PaperSummary paperId="2401.00001" summary={summary} />);
      expect(status).toHaveTextContent("要約の生成が完了しました");
      expect(status).not.toHaveTextContent(summary.summary);
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    });

    it("正常系: キャッシュ済みの要約を表示しただけでは完了を通知しない", () => {
      render(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);

      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("異常系: 生成失敗を再試行方法つきで通知する（理由はトーストに任せる）", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00001" error={new Error("APIキーが無効です")} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。「要約 + 説明文」ボタンで再試行できます。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("APIキーが無効です");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.getByRole("button", { name: /要約 \+ 説明文/i })).toBeInTheDocument();
    });

    it("異常系: 説明文のみの生成に失敗した場合は説明文の生成ボタンを案内する", () => {
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" summary={summary} isLoading />
      );

      rerender(
        <PaperSummary paperId="2401.00001" summary={summary} error={new Error("timeout")} />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "「なぜ読むべきかを生成」ボタンで再試行できます。"
      );
    });

    it("異常系: 再試行を開始すると失敗の通知を消す", () => {
      const error = new Error("timeout");
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);
      rerender(<PaperSummary paperId="2401.00001" error={error} />);
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();

      rerender(<PaperSummary paperId="2401.00001" isLoading />);

      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
      expect(screen.getByRole("status")).toHaveTextContent("要約を生成しています");
    });

    it("異常系: 生成中に別の論文へ切り替えた場合は元の論文の完了・失敗を通知しない", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00002" />);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();

      rerender(<PaperSummary paperId="2401.00002" error={new Error("timeout")} />);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    });

    it("異常系: 失敗後に言語を切り替えると失敗の通知を消す", () => {
      const error = new Error("timeout");
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);
      rerender(<PaperSummary paperId="2401.00001" error={error} />);
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();

      rerender(
        <PaperSummary
          paperId="2401.00001"
          selectedLanguage="en"
          summary={createSampleSummary({ language: "en" })}
        />
      );
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();

      // 元の言語に戻しても古い失敗を読み直さない
      rerender(<PaperSummary paperId="2401.00001" error={error} />);
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    });

    it("正常系: 状態通知でフォーカスを移動しない", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" />);
      const languageTab = screen.getByRole("tab", { name: "English" });
      languageTab.focus();
      expect(languageTab).toHaveFocus();

      rerender(<PaperSummary paperId="2401.00001" isLoading />);
      expect(languageTab).toHaveFocus();

      rerender(<PaperSummary paperId="2401.00001" error={new Error("timeout")} />);
      expect(languageTab).toHaveFocus();

      rerender(<PaperSummary paperId="2401.00001" isLoading />);
      rerender(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);
      expect(languageTab).toHaveFocus();
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
      // 外部リンクは新しいタブで開くことを支援技術にも伝える
      const pdfLink = screen.getByRole("link", { name: "本文PDF（新しいタブで開く）" });
      expect(pdfLink).toHaveAttribute("href", sourceLinkProps.pdfUrl);
      expect(pdfLink).toHaveAttribute("target", "_blank");
      const arxivLink = screen.getByRole("link", { name: "arXivページ（新しいタブで開く）" });
      expect(arxivLink).toHaveAttribute("href", sourceLinkProps.arxivUrl);
      expect(arxivLink).toHaveAttribute("target", "_blank");
    });

    it("正常系: リンクは「 / 」区切りで並び、一部だけ渡しても先頭に区切り記号が付かない", () => {
      const { container, unmount } = render(
        <PaperSummary paperId="2401.00001" {...sourceLinkProps} />
      );
      expect(container.querySelector("p")).toHaveTextContent(
        /原文を確認: Abstract \/ 本文PDF（新しいタブで開く） \/ arXivページ（新しいタブで開く）$/
      );
      unmount();

      const { container: pdfOnly } = render(
        <PaperSummary paperId="2401.00001" pdfUrl={sourceLinkProps.pdfUrl} />
      );
      expect(pdfOnly.querySelector("p")).toHaveTextContent(
        /原文を確認: 本文PDF（新しいタブで開く）$/
      );
    });

    it("正常系: Abstractリンクはページ内へスクロールし、URLと履歴を変えない", async () => {
      const user = userEvent.setup();
      const target = document.createElement("p");
      target.id = sourceLinkProps.abstractId;
      document.body.appendChild(target);
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;
      const hrefBefore = window.location.href;
      const historyLengthBefore = window.history.length;

      render(<PaperSummary paperId="2401.00001" {...sourceLinkProps} />);
      await user.click(screen.getByRole("link", { name: "Abstract" }));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe(hrefBefore);
      expect(window.history.length).toBe(historyLengthBefore);
      target.remove();
    });

    it("正常系: 原文URLが渡されない場合はリンクを表示しない", () => {
      render(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("正常系: 全文分析と誤認させる文言を表示しない", async () => {
      const misleading = /AI分析|論文の内容/;
      const { container, unmount } = render(<PaperSummary paperId="2401.00001" />);
      expect(container).not.toHaveTextContent(misleading);
      unmount();

      const { container: loading, unmount: unmountLoading } = render(
        <PaperSummary paperId="2401.00001" isLoading />
      );
      expect(loading).not.toHaveTextContent(misleading);
      unmountLoading();

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
      expect(generated).not.toHaveTextContent(misleading);

      // 説明文タブに切り替えた後も同様
      await userEvent.setup().click(screen.getByRole("tab", { name: /なぜ読むべきか/ }));
      expect(screen.getByText("サンプル効率改善の手法が分かる")).toBeInTheDocument();
      expect(generated).not.toHaveTextContent(misleading);
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
