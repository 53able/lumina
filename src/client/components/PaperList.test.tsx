/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/shared/schemas";

/**
 * PaperList テスト
 *
 * Design Docsに基づく仕様:
 * - 論文カードのリスト表示
 * - 空の場合のメッセージ表示
 * - ローディング状態の表示
 */

// テスト用のサンプル論文データ
const createSamplePaper = (id: string, title: string): Paper => ({
  id,
  title,
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-16"),
  pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
});

describe("PaperList", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 論文リストが表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "First Paper"),
        createSamplePaper("2401.00002", "Second Paper"),
        createSamplePaper("2401.00003", "Third Paper"),
      ];

      render(<PaperList papers={papers} />);

      expect(screen.getByText("First Paper")).toBeInTheDocument();
      expect(screen.getByText("Second Paper")).toBeInTheDocument();
      expect(screen.getByText("Third Paper")).toBeInTheDocument();
    });

    it("正常系: 空の場合はメッセージが表示される", async () => {
      const { PaperList } = await import("./PaperList");

      render(<PaperList papers={[]} />);

      expect(screen.getByText(/論文が見つかりません/i)).toBeInTheDocument();
    });

    it("正常系: ローディング中はスケルトンが表示される", async () => {
      const { PaperList } = await import("./PaperList");

      render(<PaperList papers={[]} isLoading />);

      // ローディング中のスケルトン要素を確認
      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
    });
  });

  describe("論文数の表示", () => {
    it("正常系: 論文数が表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "Paper 1"),
        createSamplePaper("2401.00002", "Paper 2"),
      ];

      render(<PaperList papers={papers} showCount />);

      // 件数と「件の論文」が表示されていることを確認
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText(/件の論文/)).toBeInTheDocument();
    });
  });

  describe("whyReadMap伝播", () => {
    it("正常系: whyReadMapの内容がカードに表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "Paper 1"),
        createSamplePaper("2401.00002", "Paper 2"),
      ];
      const whyReadMap = new Map([
        ["2401.00001", "最新の機械学習手法を理解できます"],
        ["2401.00002", "データ分析の効率化に役立ちます"],
      ]);

      render(<PaperList papers={papers} whyReadMap={whyReadMap} />);

      expect(screen.getByText("最新の機械学習手法を理解できます")).toBeInTheDocument();
      expect(screen.getByText("データ分析の効率化に役立ちます")).toBeInTheDocument();
    });

    it("正常系: whyReadMapが空でもエラーにならない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [createSamplePaper("2401.00001", "Paper 1")];

      render(<PaperList papers={papers} whyReadMap={new Map()} />);

      expect(screen.getByText("Paper 1")).toBeInTheDocument();
    });
  });
});
