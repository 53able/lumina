/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FC, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary as PaperSummaryType } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { usePaperSummary } from "../hooks/usePaperSummary";
import { PartialSummaryError } from "../lib/summaryErrors";
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

    it("異常系: 全体の失敗は部分成功と異なる文言で表示する", () => {
      const { rerender } = render(<PaperSummary paperId="2401.00001" isLoading />);

      rerender(<PaperSummary paperId="2401.00001" error={new Error("timeout")} />);

      expect(
        screen.getByText("生成できませんでした。「要約 + 説明文」で再試行できます。")
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

  describe("版の再生成・破棄・比較", () => {
    let db: LuminaDB;
    let dbCounter = 0;

    /** App・PaperPage と同じく usePaperSummary の採用版・版・採用/破棄を props で渡す */
    const HookedPaperSummary: FC<{
      onGenerate?: (paperId: string, language: "ja" | "en", target: GenerateTarget) => void;
      autoGenerate?: boolean;
    }> = (props) => {
      const { summary, versions, adoptVersion, discardVersion } = usePaperSummary({
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
          {...props}
        />
      );
    };
    const ConnectedPaperSummary: FC<{
      onGenerate?: (paperId: string, language: "ja" | "en", target: GenerateTarget) => void;
      autoGenerate?: boolean;
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
      useSettingsStore.setState({ apiEnabled: true });
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
