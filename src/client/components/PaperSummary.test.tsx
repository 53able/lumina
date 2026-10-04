/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FC, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary as PaperSummaryType } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { ApiDisabledError, getApiResumeHint } from "../lib/api";
import { PartialSummaryError, SummaryApiError } from "../lib/summaryErrorTypes";
import { useSettingsStore } from "../stores/settingsStore";
import {
  getAdoptedSummaries,
  initializeSummaryStore,
  type SummaryVersion,
  useSummaryStore,
} from "../stores/summaryStore";
import { type GenerateTarget, PaperSummary } from "./PaperSummary";

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
    useSettingsStore.setState({ apiKey: "", apiEnabled: true });
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

    it("正常系: ローディング中は生成ボタンを残したまま無効にし、押しても生成しない", async () => {
      const user = userEvent.setup();
      const mockOnGenerate = vi.fn();
      render(<PaperSummary paperId="2401.00001" isLoading onGenerate={mockOnGenerate} />);

      const generateButton = screen.getByRole("button", { name: /要約 \+ 説明文/ });
      expect(generateButton).toHaveAttribute("aria-disabled", "true");
      // aria-busy はボタンではなく、要約なしの状態のブロックに付ける
      expect(generateButton).not.toHaveAttribute("aria-busy");
      expect(generateButton.closest('[aria-busy="true"]')).not.toBeNull();

      generateButton.focus();
      await user.keyboard("{Enter}");
      expect(mockOnGenerate).not.toHaveBeenCalled();
    });
  });

  describe("生成中のフォーカス", () => {
    it("正常系: 「要約 + 説明文」で生成を始めてもフォーカスは押したボタンに残り、失敗後はそのまま再試行できる", async () => {
      const user = userEvent.setup();
      const mockOnGenerate = vi.fn();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" onGenerate={mockOnGenerate} />
      );

      const generateButton = screen.getByRole("button", { name: /要約 \+ 説明文/ });
      generateButton.focus();
      await user.keyboard("{Enter}");
      expect(mockOnGenerate).toHaveBeenCalledTimes(1);

      rerender(<PaperSummary paperId="2401.00001" isLoading onGenerate={mockOnGenerate} />);
      expect(document.activeElement).not.toBe(document.body);
      expect(generateButton).toHaveFocus();
      expect(screen.getByText("生成中...")).toBeInTheDocument();

      rerender(
        <PaperSummary
          paperId="2401.00001"
          error={new Error("timeout")}
          onGenerate={mockOnGenerate}
        />
      );
      expect(generateButton).toHaveFocus();
      expect(generateButton).not.toHaveAttribute("aria-disabled");

      await user.keyboard("{Enter}");
      expect(mockOnGenerate).toHaveBeenCalledTimes(2);
    });

    it("正常系: 「なぜ読むべきかを生成」で生成を始めても要約とボタンを残し、フォーカスを保つ", async () => {
      const user = userEvent.setup();
      const mockOnGenerate = vi.fn();
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" summary={summary} onGenerate={mockOnGenerate} />
      );

      const explanationButton = screen.getByRole("button", { name: /なぜ読むべきかを生成/ });
      explanationButton.focus();
      await user.keyboard("{Enter}");
      expect(mockOnGenerate).toHaveBeenCalledWith("2401.00001", "ja", "explanation");

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          isLoading
          onGenerate={mockOnGenerate}
        />
      );
      expect(document.activeElement).not.toBe(document.body);
      expect(explanationButton).toHaveFocus();
      expect(explanationButton).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText(summary.summary)).toBeInTheDocument();

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new Error("timeout")}
          failedTarget="explanation"
          onGenerate={mockOnGenerate}
        />
      );
      expect(explanationButton).toHaveFocus();
    });

    it("正常系: 完了で押したボタンが消えたときは、AI要約の見出しへフォーカスを戻す", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<PaperSummary paperId="2401.00001" onGenerate={vi.fn()} />);

      screen.getByRole("button", { name: /要約 \+ 説明文/ }).focus();
      await user.keyboard("{Enter}");
      rerender(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={createSampleSummary({ explanation: "説明文" })}
        />
      );

      expect(screen.queryByRole("button", { name: /要約 \+ 説明文/ })).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
      expect(screen.getByRole("heading", { name: "AI要約" })).toHaveFocus();
    });

    it("異常系: 生成開始時に外の要素にあったフォーカスは、その要素が生成中に消えても見出しへ移さない", async () => {
      const Harness: FC<{
        showOutside: boolean;
        isLoading?: boolean;
        summary?: PaperSummaryType;
      }> = ({ showOutside, ...props }) => (
        <>
          {showOutside && <button type="button">外のボタン</button>}
          <PaperSummary paperId="2401.00001" {...props} />
        </>
      );
      const { rerender } = render(<Harness showOutside />);

      screen.getByRole("button", { name: "外のボタン" }).focus();
      rerender(<Harness showOutside isLoading />);
      // 生成中に外の要素が消える（フォーカスは body に落ちる）
      rerender(<Harness showOutside={false} isLoading />);
      expect(document.activeElement).toBe(document.body);

      rerender(
        <Harness showOutside={false} summary={createSampleSummary({ explanation: "説明文" })} />
      );
      expect(screen.getByRole("heading", { name: "AI要約" })).not.toHaveFocus();
    });

    it("正常系: 生成中に利用者が移したフォーカスは、完了後も動かさない", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<PaperSummary paperId="2401.00001" onGenerate={vi.fn()} />);

      screen.getByRole("button", { name: /要約 \+ 説明文/ }).focus();
      await user.keyboard("{Enter}");
      rerender(<PaperSummary paperId="2401.00001" isLoading />);

      const languageTab = screen.getByRole("tab", { name: "English" });
      languageTab.focus();

      rerender(<PaperSummary paperId="2401.00001" summary={createSampleSummary()} />);
      expect(languageTab).toHaveFocus();
    });
  });

  describe("生成中の表示", () => {
    const summaryWithoutExplanation = createSampleSummary();

    it("正常系: 説明文だけの生成中は「なぜ読むべきかを生成」の隣にだけ生成中を出し、要約は薄くしない", () => {
      render(
        <PaperSummary
          paperId="2401.00001"
          summary={summaryWithoutExplanation}
          isLoading
          generatingTarget="explanation"
        />
      );

      const loadingTexts = screen.getAllByText("生成中...");
      expect(loadingTexts).toHaveLength(1);
      expect(loadingTexts[0]?.parentElement).toContainElement(
        screen.getByRole("button", { name: /なぜ読むべきかを生成/ })
      );
      expect(screen.getByText(summaryWithoutExplanation.summary).parentElement).not.toHaveClass(
        "opacity-50"
      );
    });

    it("正常系: 再生成中は「再生成」の隣にだけ生成中を出し、置き換わる前の要約を薄く表示する", () => {
      render(
        <PaperSummary
          paperId="2401.00001"
          summary={summaryWithoutExplanation}
          isLoading
          generatingTarget="both"
        />
      );

      const loadingTexts = screen.getAllByText("生成中...");
      expect(loadingTexts).toHaveLength(1);
      expect(loadingTexts[0]?.parentElement).toContainElement(
        screen.getByRole("button", { name: "再生成" })
      );
      expect(screen.getByText(summaryWithoutExplanation.summary).parentElement).toHaveClass(
        "opacity-50"
      );
    });

    it("正常系: aria-busy はボタンではなく要約ブロックに付ける", () => {
      render(
        <PaperSummary
          paperId="2401.00001"
          summary={summaryWithoutExplanation}
          isLoading
          generatingTarget="both"
        />
      );

      const regenerateButton = screen.getByRole("button", { name: "再生成" });
      expect(regenerateButton).not.toHaveAttribute("aria-busy");
      expect(regenerateButton.closest('[aria-busy="true"]')).toContainElement(
        screen.getByText(summaryWithoutExplanation.summary)
      );
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

    it("異常系: 説明文だけが失敗した部分成功では、要約を表示し説明文だけの再試行を案内する", async () => {
      const user = userEvent.setup();
      const mockOnGenerate = vi.fn();
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" isLoading onGenerate={mockOnGenerate} />
      );

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new PartialSummaryError("upstream", true)}
          onGenerate={mockOnGenerate}
        />
      );

      // 成功済みの要約は表示される
      expect(screen.getByText(summary.summary)).toBeInTheDocument();
      // 部分成功を失敗と区別して通知・表示する
      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約は保存済みです。説明文を生成できませんでした。「なぜ読むべきかを生成」ボタンで説明文だけを再試行できます。"
      );
      expect(
        screen.getByText(/要約は保存済みです。説明文は生成できませんでした。/)
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();

      // 再試行は説明文だけを対象にする
      await user.click(screen.getByRole("button", { name: /なぜ読むべきかを生成/ }));
      expect(mockOnGenerate).toHaveBeenCalledWith("2401.00001", "ja", "explanation");
    });

    it("異常系: 再試行で解決しない部分成功（auth）は再試行ではなく対処方法を案内する", () => {
      const summary = createSampleSummary();
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new PartialSummaryError("auth", false)}
        />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約は保存済みです。説明文を生成できませんでした。APIキーの設定を確認してください。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
      expect(
        screen.getByText(
          "要約は保存済みです。説明文は生成できませんでした。APIキーの設定を確認してください。"
        )
      ).toBeInTheDocument();
    });

    it("異常系: 再試行で解決しない全体の失敗（auth）は再試行ではなく設定の確認を案内する", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00001" error={new SummaryApiError("auth", false)} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。APIキーの設定を確認してください。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
      expect(
        screen.getByText("生成できませんでした。APIキーの設定を確認してください。")
      ).toBeInTheDocument();
      expect(screen.queryByText(/再試行できます/)).not.toBeInTheDocument();
    });

    it("異常系: 説明文のみの生成が auth で失敗した場合も、再試行ではなく設定の確認を案内する", () => {
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" summary={summary} isLoading />
      );

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new SummaryApiError("auth", false)}
          failedTarget="explanation"
        />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約は保存済みです。説明文を生成できませんでした。APIキーの設定を確認してください。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
      expect(
        screen.getByText(
          "要約は保存済みです。説明文は生成できませんでした。APIキーの設定を確認してください。"
        )
      ).toBeInTheDocument();
    });

    it("異常系: 再試行できる全体の失敗（rate_limit）は従来どおり再試行を案内する", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(
        <PaperSummary paperId="2401.00001" error={new SummaryApiError("rate_limit", true)} />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。「要約 + 説明文」ボタンで再試行できます。"
      );
      expect(
        screen.getByText("生成できませんでした。「要約 + 説明文」ボタンで再試行できます。")
      ).toBeInTheDocument();
    });

    it("異常系: API利用OFFによる失敗は再試行ではなく再開方法を案内する（キー保存済み）", () => {
      useSettingsStore.setState({ apiKey: "encrypted-key" });
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00001" error={new ApiDisabledError()} />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。設定の「利用可能」をONにすると再開できます。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
      expect(
        screen.getByText("生成できませんでした。設定の「利用可能」をONにすると再開できます。")
      ).toBeInTheDocument();
    });

    it("異常系: API利用OFFでキー未保存の場合は、キーの保存から案内する", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(
        <PaperSummary paperId="2401.00001" error={new ApiDisabledError(getApiResumeHint(false))} />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。設定でAPIキーを保存し、「利用可能」をONにすると再開できます。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
    });

    it("異常系: API利用OFFの再開方法は、失敗時ではなく表示時点のキー有無で案内する", () => {
      useSettingsStore.setState({ apiEnabled: false, apiKey: "encrypted-key" });
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      // 失敗時はキー未保存だった（エラーの resumeHint はキーの保存から案内する）
      rerender(
        <PaperSummary paperId="2401.00001" error={new ApiDisabledError(getApiResumeHint(false))} />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約を生成できませんでした。設定の「利用可能」をONにすると再開できます。"
      );
      expect(
        screen.getByText("生成できませんでした。設定の「利用可能」をONにすると再開できます。")
      ).toBeInTheDocument();

      // 表示中にキーを削除すると、再描画でキーの保存からの案内に切り替わる
      act(() => {
        useSettingsStore.setState({ apiKey: "" });
      });

      expect(
        screen.getByText(
          "生成できませんでした。設定でAPIキーを保存し、「利用可能」をONにすると再開できます。"
        )
      ).toBeInTheDocument();
    });

    it("異常系: 要約がある状態で説明文の生成がAPI利用OFFで失敗した場合は、要約を残して再開方法を案内する", () => {
      useSettingsStore.setState({ apiEnabled: false, apiKey: "encrypted-key" });
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" summary={summary} isLoading />
      );

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new ApiDisabledError()}
          failedTarget="explanation"
        />
      );

      expect(screen.getByText(summary.summary)).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約は保存済みです。説明文を生成できませんでした。設定の「利用可能」をONにすると再開できます。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("再試行");
      expect(
        screen.getByText(
          "要約は保存済みです。説明文は生成できませんでした。設定の「利用可能」をONにすると再開できます。"
        )
      ).toBeInTheDocument();
    });

    it("異常系: 全体の失敗は部分成功と異なる文言で表示する", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00001" error={new Error("timeout")} />);

      expect(
        screen.getByText("生成できませんでした。「要約 + 説明文」ボタンで再試行できます。")
      ).toBeInTheDocument();
      expect(screen.queryByText(/要約は保存済みです/)).not.toBeInTheDocument();
    });

    it("異常系: 部分成功後の説明文のみの再試行が失敗しても、要約の失敗として伝えない", () => {
      const summary = createSampleSummary();
      const { rerender } = render(
        <PaperSummary paperId="2401.00001" summary={summary} isLoading />
      );

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          error={new Error("timeout")}
          failedTarget="explanation"
        />
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        "要約は保存済みです。説明文を生成できませんでした。「なぜ読むべきかを生成」ボタンで説明文だけを再試行できます。"
      );
      expect(screen.getByRole("alert")).not.toHaveTextContent("要約を生成できませんでした");
      expect(
        screen.getByText(/要約は保存済みです。説明文は生成できませんでした。/)
      ).toBeInTheDocument();
      expect(screen.getByText(summary.summary)).toBeInTheDocument();
    });

    it("正常系: 完了時は失敗・部分成功の表示を出さない", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);
      expect(screen.getByText("生成中...")).toBeInTheDocument();

      rerender(
        <PaperSummary
          paperId="2401.00001"
          summary={createSampleSummary({ explanation: "説明文" })}
        />
      );

      expect(screen.getByRole("status")).toHaveTextContent("要約の生成が完了しました");
      expect(screen.queryByText(/生成できませんでした/)).not.toBeInTheDocument();
      expect(screen.queryByText("生成中...")).not.toBeInTheDocument();
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

    it("正常系: 説明文はAIの推測（読むと得られること）として論文中の記述と区別して表示される", async () => {
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

      expect(
        screen.getByText(/読むと得られること（AI）です。論文中の記述ではありません/)
      ).toBeInTheDocument();
    });
  });

  describe("版の再生成・破棄・比較", () => {
    let db: LuminaDB;
    let dbCounter = 0;

    /** App・PaperPage と同じく usePaperSummary の採用版・版・採用/破棄を props で渡す */
    const HookedPaperSummary: FC<{
      onGenerate?: (paperId: string, language: "ja" | "en", target: GenerateTarget) => void;
      autoGenerate?: boolean;
      isLoading?: boolean;
    }> = (props) => {
      const { summary, versions, adoptVersion, discardVersion, saveCorrection } = usePaperSummary({
        paperId: "2401.00001",
        abstract: "Abstract",
      });
      return (
        <PaperSummary
          paperId="2401.00001"
          summary={summary}
          versions={versions}
          onAdoptVersion={adoptVersion}
          onDiscardVersion={discardVersion}
          onSaveCorrection={saveCorrection}
          {...props}
        />
      );
    };
    const ConnectedPaperSummary: FC<{
      onGenerate?: (paperId: string, language: "ja" | "en", target: GenerateTarget) => void;
      autoGenerate?: boolean;
      isLoading?: boolean;
    }> = (props) => (
      <QueryClientProvider client={new QueryClient()}>
        <HookedPaperSummary {...props} />
      </QueryClientProvider>
    );

    /** 同じ論文・言語の版を古い順に保存する */
    const addVersions = async (texts: string[]) => {
      for (const text of texts) {
        await useSummaryStore
          .getState()
          .addSummary(createSampleSummary({ summary: text, keyPoints: [`${text}のポイント`] }));
      }
    };

    beforeEach(async () => {
      dbCounter += 1;
      db = createLuminaDb(`PaperSummary-versions-test-${dbCounter}`);
      useSummaryStore.setState({ summaries: [] });
      await initializeSummaryStore(db);
    });

    afterEach(async () => {
      await db.delete();
    });

    it("正常系: 再生成ボタンは確認なしで要約と説明文の生成を呼ぶ", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      await addVersions(["第1版の要約"]);
      render(<ConnectedPaperSummary onGenerate={onGenerate} />);

      await user.click(screen.getByRole("button", { name: "再生成" }));

      expect(onGenerate).toHaveBeenCalledWith("2401.00001", "ja", "both");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("正常系: 再生成中も再生成ボタンにフォーカスを残し、版の破棄・比較は出さない", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      await addVersions(["第1版の要約", "第2版の要約"]);
      const queryClient = new QueryClient();
      const renderWith = (isLoading: boolean) => (
        <QueryClientProvider client={queryClient}>
          <HookedPaperSummary onGenerate={onGenerate} isLoading={isLoading} />
        </QueryClientProvider>
      );
      const { rerender } = render(renderWith(false));

      const regenerateButton = screen.getByRole("button", { name: "再生成" });
      regenerateButton.focus();
      await user.keyboard("{Enter}");
      expect(onGenerate).toHaveBeenCalledTimes(1);

      rerender(renderWith(true));
      expect(document.activeElement).not.toBe(document.body);
      expect(regenerateButton).toHaveFocus();
      expect(regenerateButton).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("生成中...")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "採用中の版を破棄" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /版を比較/ })).not.toBeInTheDocument();

      await user.keyboard("{Enter}");
      expect(onGenerate).toHaveBeenCalledTimes(1);

      rerender(renderWith(false));
      expect(regenerateButton).toHaveFocus();
      expect(screen.getByRole("button", { name: "採用中の版を破棄" })).toBeInTheDocument();
    });

    it("正常系: API利用OFF中は再生成を無効にし、理由を関連付けて表示する", async () => {
      useSettingsStore.setState({ apiEnabled: false });
      await addVersions(["第1版の要約"]);
      render(<ConnectedPaperSummary onGenerate={vi.fn()} />);

      const button = screen.getByRole("button", { name: "再生成" });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(/API利用OFFのため再生成を停止中/);
    });

    it("正常系: 版が1つだけなら比較ボタンと採用版バッジを出さない", async () => {
      await addVersions(["第1版の要約"]);
      render(<ConnectedPaperSummary />);

      expect(screen.queryByRole("button", { name: /版を比較/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/採用中:/)).not.toBeInTheDocument();
    });

    it("正常系: 版を並べて比較し、旧版を採用すると表示が切り替わり、再読込後も維持される", async () => {
      const user = userEvent.setup();
      await addVersions(["第1版の要約", "第2版の要約"]);
      render(<ConnectedPaperSummary />);

      // 再生成した版（第2版）が採用版として表示される
      expect(screen.getByText("採用中: 第2版 / 全2版")).toBeInTheDocument();
      const toggle = screen.getByRole("button", { name: "版を比較（2版）" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const list = screen.getByRole("region", { name: "保存済みの要約の版" });
      expect(within(list).getByText("第1版の要約")).toBeInTheDocument();
      expect(within(list).getByText("第2版の要約")).toBeInTheDocument();
      expect(within(list).getByText("採用中")).toBeInTheDocument();
      expect(within(list).queryByRole("button", { name: "第2版を採用" })).not.toBeInTheDocument();

      await user.click(within(list).getByRole("button", { name: "第1版を採用" }));

      expect(await screen.findByText("採用中: 第1版 / 全2版")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("第1版を採用しました");
      // 押した「第1版を採用」ボタンは消えるため、採用した版の見出しへフォーカスを移す
      await waitFor(() =>
        expect(document.activeElement).toBe(within(list).getByRole("heading", { name: /^第1版/ }))
      );
      // 採用は保存され、再読込（Store の再初期化）後も維持される
      useSummaryStore.setState({ summaries: [] });
      await initializeSummaryStore(db);
      expect(
        useSummaryStore.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary
      ).toBe("第1版の要約");
    });

    it("正常系: 破棄は確認ダイアログで確定し、キャンセルすると破棄しない", async () => {
      const user = userEvent.setup();
      await addVersions(["第1版の要約", "第2版の要約"]);
      render(<ConnectedPaperSummary />);

      await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
      const dialog = await screen.findByRole("dialog", { name: "第2版の要約を破棄しますか？" });
      expect(dialog).toHaveTextContent("残りの版のうち最新の版を採用します");

      await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(useSummaryStore.getState().summaries).toHaveLength(2);
    });

    it("正常系: 採用版を破棄すると残りの最新の版を表示し、見出しへフォーカスを戻す", async () => {
      const user = userEvent.setup();
      await addVersions(["第1版の要約", "第2版の要約", "第3版の要約"]);
      render(<ConnectedPaperSummary />);

      await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "破棄する" }));

      expect(await screen.findByText("採用中: 第2版 / 全2版")).toBeInTheDocument();
      expect(screen.getByText("第2版の要約")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "第3版を破棄しました。残りの版のうち最新の版を採用しています"
      );
      await waitFor(() => expect(screen.getByRole("heading", { name: "AI要約" })).toHaveFocus());
      expect(await db.paperSummaries.count()).toBe(2);
    });

    it("正常系: 最後の版を破棄しても自動生成で作り直さない", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      await addVersions(["第1版の要約"]);
      render(<ConnectedPaperSummary onGenerate={onGenerate} autoGenerate />);

      await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("保存済みの版がなくなります");
      await user.click(within(dialog).getByRole("button", { name: "破棄する" }));

      expect(await screen.findByRole("button", { name: /要約 \+ 説明文/ })).toBeInTheDocument();
      expect(onGenerate).not.toHaveBeenCalled();
    });

    it("異常系: 破棄に失敗したら自動生成の抑止を戻す", async () => {
      const user = userEvent.setup();
      const onGenerate = vi.fn();
      const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
      const props = {
        paperId: "2401.00001",
        onGenerate,
        autoGenerate: true,
        onAdoptVersion: vi.fn(),
        onDiscardVersion: vi.fn().mockRejectedValue(new Error("DB error")),
      };
      const { rerender } = render(
        <PaperSummary {...props} summary={version} versions={[version]} />
      );

      await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "破棄する" })
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // 破棄は失敗したので抑止しない（その後に要約がなくなれば、通常どおり自動生成する）
      rerender(<PaperSummary {...props} summary={undefined} versions={[]} />);
      expect(onGenerate).toHaveBeenCalledWith("2401.00001", "ja", "both");
    });

    describe("利用者の訂正", () => {
      /** 表示中の論文・言語の版を DB から読み直す（再読込の代わり） */
      const reloadStore = async () => {
        useSummaryStore.setState({ summaries: [] });
        await initializeSummaryStore(db);
      };
      /** 訂正の入力欄を開いて文字を入れる */
      const typeCorrection = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
        await user.click(screen.getByRole("button", { name: /訂正を(追加|編集)/ }));
        const textarea = screen.getByRole("textbox", { name: /要約への訂正/ });
        await user.clear(textarea);
        await user.type(textarea, text);
        return textarea;
      };

      it("正常系: 訂正文を入力・保存すると、AI要約と区別して表示し、見出しへフォーカスを移す", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        render(<ConnectedPaperSummary />);

        await user.click(screen.getByRole("button", { name: "訂正を追加" }));
        const textarea = screen.getByRole("textbox", { name: "要約への訂正" });
        expect(textarea).toHaveFocus();
        expect(textarea).toHaveAttribute("maxLength", "2000");
        expect(textarea).toHaveAccessibleDescription(/0 \/ 2000文字/);
        await user.type(textarea, "提案手法の名称が誤り");
        expect(textarea).toHaveAccessibleDescription(/10 \/ 2000文字/);
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        const section = await screen.findByRole("region", {
          name: "利用者の訂正（要約本文への訂正）",
        });
        expect(within(section).getByText("提案手法の名称が誤り")).toBeInTheDocument();
        expect(within(section).getByText("AI生成ではありません")).toBeInTheDocument();
        // AI生成文は書き換えず、訂正の枠の外に残す
        expect(within(section).queryByText("AIの要約")).not.toBeInTheDocument();
        expect(screen.getByText("AIの要約")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("訂正を保存しました");
        await waitFor(() =>
          expect(
            within(section).getByRole("heading", { name: "利用者の訂正（要約本文への訂正）" })
          ).toHaveFocus()
        );
        expect(screen.getByRole("button", { name: "訂正を編集" })).toBeInTheDocument();
      });

      it("正常系: 再読込（Store の再初期化）後も訂正文を表示する", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        const { unmount } = render(<ConnectedPaperSummary />);
        await typeCorrection(user, "再読込後も残る訂正");
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));
        await screen.findByRole("region", { name: "利用者の訂正（要約本文への訂正）" });
        unmount();

        await reloadStore();
        render(<ConnectedPaperSummary />);

        const section = screen.getByRole("region", { name: "利用者の訂正（要約本文への訂正）" });
        expect(within(section).getByText("再読込後も残る訂正")).toBeInTheDocument();
        expect(screen.getByText("AIの要約")).toBeInTheDocument();
      });

      it("正常系: 取消すと保存せず、編集ボタンへフォーカスを戻す", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        render(<ConnectedPaperSummary />);

        await typeCorrection(user, "保存しない訂正");
        await user.click(screen.getByRole("button", { name: "取消" }));

        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
        ).not.toBeInTheDocument();
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "訂正を追加" })).toHaveFocus()
        );
        expect((await db.paperSummaries.toArray())[0]).not.toHaveProperty("userCorrection");
      });

      it("正常系: 空にして保存すると訂正を削除する", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        await useSummaryStore
          .getState()
          .saveCorrection(useSummaryStore.getState().summaries[0].id, "消す訂正");
        render(<ConnectedPaperSummary />);

        await user.click(screen.getByRole("button", { name: "訂正を編集" }));
        await user.clear(screen.getByRole("textbox", { name: "要約への訂正" }));
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        await waitFor(() =>
          expect(
            screen.queryByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
          ).not.toBeInTheDocument()
        );
        expect(screen.getByRole("status")).toHaveTextContent("訂正を削除しました");
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "訂正を追加" })).toHaveFocus()
        );
      });

      it("正常系: 再生成した新しい版には引き継がず、その旨を示し、旧版を採用し直すと表示する", async () => {
        const user = userEvent.setup();
        await addVersions(["第1版の要約"]);
        await useSummaryStore
          .getState()
          .saveCorrection(useSummaryStore.getState().summaries[0].id, "第1版への訂正");
        render(<ConnectedPaperSummary />);
        expect(
          screen.getByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
        ).toHaveTextContent("再生成した新しい版には引き継がれません");

        // 再生成で新しい版が採用版になる
        await act(() =>
          useSummaryStore.getState().addSummary(createSampleSummary({ summary: "第2版の要約" }))
        );

        expect(
          screen.queryByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
        ).not.toBeInTheDocument();
        expect(
          screen.getByText(/第1版に利用者の訂正があります。.*表示中の版には引き継がれません/)
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "版を比較（2版）" }));
        const list = screen.getByRole("region", { name: "保存済みの要約の版" });
        expect(within(list).getByText("第1版への訂正")).toBeInTheDocument();
        expect(
          within(list).getByRole("heading", {
            name: "利用者の訂正（要約本文への訂正。AI生成ではありません）",
          })
        ).toBeInTheDocument();

        await user.click(within(list).getByRole("button", { name: "第1版を採用" }));

        const section = await screen.findByRole("region", {
          name: "利用者の訂正（要約本文への訂正）",
        });
        expect(within(section).getByText("第1版への訂正")).toBeInTheDocument();
      });

      it("正常系: 訂正の付いた版の破棄は、訂正も消えることを確認ダイアログで示す", async () => {
        const user = userEvent.setup();
        await addVersions(["第1版の要約", "第2版の要約"]);
        await useSummaryStore
          .getState()
          .saveCorrection(useSummaryStore.getState().summaries[1].id, "第2版への訂正");
        render(<ConnectedPaperSummary />);

        await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent("この版に付けた利用者の訂正も削除されます。");
        await user.click(within(dialog).getByRole("button", { name: "破棄する" }));

        expect(await screen.findByText("第1版の要約")).toBeInTheDocument();
        expect(
          screen.queryByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
        ).not.toBeInTheDocument();
        await act(reloadStore);
        expect(useSummaryStore.getState().summaries.some((s) => s.userCorrection)).toBe(false);
      });

      it("正常系: 訂正のない版の破棄では訂正の削除を示さない", async () => {
        const user = userEvent.setup();
        await addVersions(["第1版の要約"]);
        render(<ConnectedPaperSummary />);

        await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
        expect(await screen.findByRole("dialog")).not.toHaveTextContent("利用者の訂正");
      });

      it("正常系: 編集中に別の版が採用されても、編集を始めた版に保存する", async () => {
        const user = userEvent.setup();
        await addVersions(["第1版の要約", "第2版の要約"]);
        const [first, second] = useSummaryStore.getState().summaries;
        render(<ConnectedPaperSummary />);

        await typeCorrection(user, "第2版への訂正");
        expect(screen.getByRole("textbox", { name: "第2版の要約への訂正" })).toBeInTheDocument();
        // 別の操作（別のタブを含む）で第1版が採用される
        await act(() => useSummaryStore.getState().adoptSummary(first.id));
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        expect(await screen.findByText("第2版の訂正を保存しました")).toBeInTheDocument();
        await act(reloadStore);
        const reloaded = useSummaryStore.getState();
        expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.id).toBe(first.id);
        expect(reloaded.summaries.find((s) => s.id === second.id)?.userCorrection?.text).toBe(
          "第2版への訂正"
        );
        expect(reloaded.summaries.find((s) => s.id === first.id)?.userCorrection).toBeUndefined();
      });

      it("正常系: 保存中に利用者が編集欄の外へ移したフォーカスは奪わない", async () => {
        const user = userEvent.setup();
        const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
        let resolveSave: () => void = () => undefined;
        const onSaveCorrection = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveSave = resolve;
            })
        );
        render(
          <>
            <PaperSummary
              paperId="2401.00001"
              summary={version}
              versions={[version]}
              onSaveCorrection={onSaveCorrection}
            />
            <button type="button">外のボタン</button>
          </>
        );

        await typeCorrection(user, "訂正");
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));
        expect(onSaveCorrection).toHaveBeenCalledWith(1, "訂正");
        const outside = screen.getByRole("button", { name: "外のボタン" });
        outside.focus();
        await act(async () => resolveSave());

        await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
        expect(outside).toHaveFocus();
      });

      it("異常系: 保存に失敗したら編集欄と下書きを残す", async () => {
        const user = userEvent.setup();
        const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
        render(
          <PaperSummary
            paperId="2401.00001"
            summary={version}
            versions={[version]}
            onSaveCorrection={vi.fn().mockRejectedValue(new Error("DB error"))}
          />
        );

        await typeCorrection(user, "残す下書き");
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        await waitFor(() =>
          expect(screen.getByRole("button", { name: "訂正を保存" })).not.toHaveAttribute(
            "aria-disabled"
          )
        );
        expect(screen.getByRole("textbox", { name: "要約への訂正" })).toHaveValue("残す下書き");
        expect(
          screen.queryByRole("region", { name: "利用者の訂正（要約本文への訂正）" })
        ).not.toBeInTheDocument();
      });

      it("異常系: 生成完了の後に保存が失敗しても、生成の完了通知を再び入れない", async () => {
        const user = userEvent.setup();
        const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
        const props = {
          paperId: "2401.00001",
          summary: version,
          versions: [version],
          onSaveCorrection: vi.fn().mockRejectedValue(new Error("DB error")),
        };
        const { rerender } = render(<PaperSummary {...props} isLoading />);
        rerender(<PaperSummary {...props} isLoading={false} />);
        expect(screen.getByRole("status")).toHaveTextContent("要約の生成が完了しました");

        await typeCorrection(user, "下書き");
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        await waitFor(() => expect(props.onSaveCorrection).toHaveBeenCalled());
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "訂正を保存" })).not.toHaveAttribute(
            "aria-disabled"
          )
        );
        expect(screen.getByRole("status")).toHaveTextContent("");
      });

      it("正常系: 保存中は入力欄を読み取り専用にし、取消できない", async () => {
        const user = userEvent.setup();
        const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
        let resolveSave: () => void = () => undefined;
        render(
          <PaperSummary
            paperId="2401.00001"
            summary={version}
            versions={[version]}
            onSaveCorrection={() =>
              new Promise<void>((resolve) => {
                resolveSave = resolve;
              })
            }
          />
        );

        const textarea = await typeCorrection(user, "訂正");
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        expect(textarea).toHaveAttribute("readOnly");
        const cancel = screen.getByRole("button", { name: "取消" });
        expect(cancel).toHaveAttribute("aria-disabled", "true");
        await user.click(cancel);
        expect(screen.getByRole("textbox", { name: "要約への訂正" })).toBe(textarea);

        await act(async () => resolveSave());
        await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
      });

      it("異常系: 別のタブで破棄された版への保存は、破棄済みと伝えて編集欄を閉じる", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        const [only] = useSummaryStore.getState().summaries;
        render(<ConnectedPaperSummary />);

        await typeCorrection(user, "保存できない訂正");
        // 別のタブでの破棄（この画面の Store には残る）
        await db.paperSummaries.delete(only.id as unknown as string);
        await user.click(screen.getByRole("button", { name: "訂正を保存" }));

        await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
        expect(screen.getByRole("status")).toHaveTextContent(
          "この版は破棄されています。訂正は保存していません"
        );
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "訂正を追加" })).toHaveFocus()
        );
      });

      it("正常系: 未保存の下書きがある版の破棄は、下書きが失われることを確認ダイアログで示す", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        render(<ConnectedPaperSummary />);

        await typeCorrection(user, "未保存の下書き");
        await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));

        expect(await screen.findByRole("dialog")).toHaveTextContent(
          "編集中の訂正の未保存の下書きも失われます。"
        );
      });

      it("正常系: 生成中に取消して編集ボタンがなければ、AI要約の見出しへフォーカスを戻す", async () => {
        const user = userEvent.setup();
        await addVersions(["AIの要約"]);
        const queryClient = new QueryClient();
        const renderWith = (isLoading: boolean) => (
          <QueryClientProvider client={queryClient}>
            <HookedPaperSummary isLoading={isLoading} />
          </QueryClientProvider>
        );
        const { rerender } = render(renderWith(false));

        await typeCorrection(user, "下書き");
        rerender(renderWith(true));
        await user.click(screen.getByRole("button", { name: "取消" }));

        expect(screen.queryByRole("button", { name: /訂正を/ })).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole("heading", { name: "AI要約" })).toHaveFocus());
      });

      it("正常系: 文字数は前後の空白を除いた長さで示す", async () => {
        const user = userEvent.setup();
        const version: SummaryVersion = { ...createSampleSummary(), id: 1 };
        render(
          <PaperSummary
            paperId="2401.00001"
            summary={version}
            versions={[version]}
            onSaveCorrection={vi.fn()}
          />
        );

        const textarea = await typeCorrection(user, "  訂正  ");

        expect(textarea).toHaveAccessibleDescription(/^2 \/ 2000文字/);
      });

      it("正常系: 保存処理を渡さない場合は訂正の入力を出さない", async () => {
        await addVersions(["AIの要約"]);
        const version = useSummaryStore.getState().summaries[0];
        render(<PaperSummary paperId="2401.00001" summary={version} versions={[version]} />);

        expect(screen.queryByRole("button", { name: /訂正を/ })).not.toBeInTheDocument();
      });
    });

    describe("採用・破棄の通知", () => {
      /** 版を手元の state で持ち、採用・破棄を反映する（Store を介さず通知の推移だけを見る） */
      const LocalVersions: FC<{ isLoading: boolean }> = ({ isLoading }) => {
        const [versions, setVersions] = useState<SummaryVersion[]>(
          [1, 2, 3].map((id) => ({
            ...createSampleSummary({ summary: `第${id}版の要約`, adopted: id === 3 }),
            id,
          }))
        );
        const adopt = async (id: number) => {
          await Promise.resolve();
          setVersions((vs) => vs.map((v) => ({ ...v, adopted: v.id === id })));
        };
        const discard = async (id: number) => {
          await Promise.resolve();
          setVersions((vs) => {
            const remaining = vs.filter((v) => v.id !== id);
            const hasAdopted = remaining.some((v) => v.adopted);
            return remaining.map((v, i) =>
              hasAdopted ? v : { ...v, adopted: i === remaining.length - 1 }
            );
          });
        };
        return (
          <PaperSummary
            paperId="2401.00001"
            summary={getAdoptedSummaries(versions, "ja").get("2401.00001")}
            versions={versions}
            isLoading={isLoading}
            onAdoptVersion={adopt}
            onDiscardVersion={discard}
          />
        );
      };

      /** live region の文言の推移を記録する（空と連続する同じ文言は除く） */
      const recordStatus = () => {
        const status = screen.getByRole("status");
        const texts: string[] = [];
        const record = () => {
          const text = status.textContent ?? "";
          if (text !== "" && texts.at(-1) !== text) texts.push(text);
        };
        record();
        const observer = new MutationObserver(record);
        observer.observe(status, { childList: true, characterData: true, subtree: true });
        return { texts, stop: () => observer.disconnect() };
      };

      it("正常系: 生成完了の後に採用を続けても、完了の通知を再び入れない", async () => {
        const user = userEvent.setup();
        const { rerender } = render(<LocalVersions isLoading />);
        rerender(<LocalVersions isLoading={false} />);
        const { texts, stop } = recordStatus();

        await user.click(screen.getByRole("button", { name: "版を比較（3版）" }));
        await user.click(screen.getByRole("button", { name: "第1版を採用" }));
        await screen.findByText("採用中: 第1版 / 全3版");
        await user.click(screen.getByRole("button", { name: "第2版を採用" }));
        await screen.findByText("採用中: 第2版 / 全3版");
        stop();

        expect(texts).toEqual([
          "要約の生成が完了しました",
          "第1版を採用しました",
          "第2版を採用しました",
        ]);
      });

      it("正常系: 生成完了の後に破棄を続けても、完了の通知を再び入れない", async () => {
        const user = userEvent.setup();
        const { rerender } = render(<LocalVersions isLoading />);
        rerender(<LocalVersions isLoading={false} />);
        const { texts, stop } = recordStatus();

        await user.click(screen.getByRole("button", { name: "採用中の版を破棄" }));
        await user.click(
          within(await screen.findByRole("dialog")).getByRole("button", { name: "破棄する" })
        );
        await screen.findByText("採用中: 第2版 / 全2版");
        await user.click(screen.getByRole("button", { name: "版を比較（2版）" }));
        await user.click(screen.getByRole("button", { name: "第1版を破棄" }));
        await user.click(
          within(await screen.findByRole("dialog")).getByRole("button", { name: "破棄する" })
        );
        await waitFor(() =>
          expect(screen.queryByRole("button", { name: /版を比較/ })).not.toBeInTheDocument()
        );
        stop();

        expect(texts).toEqual([
          "要約の生成が完了しました",
          "第3版を破棄しました。残りの版のうち最新の版を採用しています",
          "第1版を破棄しました",
        ]);
      });
    });
  });
});
