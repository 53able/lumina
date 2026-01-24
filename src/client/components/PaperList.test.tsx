/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index.js";

// InteractionContextをモック（PaperCardで使用される）
vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteraction: (_paperId: string) => ({
    isLiked: false,
    isBookmarked: false,
    toggleLike: vi.fn(),
    toggleBookmark: vi.fn(),
  }),
}));

/**
 * MemoryRouterでラップしたレンダリングヘルパー
 */
const renderWithRouter = (ui: ReactNode) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

/**
 * PaperList テスト
 *
 * Design Docsに基づく仕様:
 * - 論文カードのリスト表示
 * - 空の場合のメッセージ表示
 * - ローディング状態の表示
 * - 無限スクロール（スクロールイベント）
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
    vi.clearAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 論文リストが表示される", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [
        createSamplePaper("2401.00001", "First Paper"),
        createSamplePaper("2401.00002", "Second Paper"),
        createSamplePaper("2401.00003", "Third Paper"),
      ];

      renderWithRouter(<PaperList papers={papers} />);

      expect(screen.getByText("First Paper")).toBeInTheDocument();
      expect(screen.getByText("Second Paper")).toBeInTheDocument();
      expect(screen.getByText("Third Paper")).toBeInTheDocument();
    });

    it("正常系: 空の場合はメッセージが表示される", async () => {
      const { PaperList } = await import("./PaperList");

      renderWithRouter(<PaperList papers={[]} />);

      expect(screen.getByText(/論文が見つかりません/i)).toBeInTheDocument();
    });

    it("正常系: ローディング中はスケルトンが表示される", async () => {
      const { PaperList } = await import("./PaperList");

      renderWithRouter(<PaperList papers={[]} isLoading />);

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

      renderWithRouter(<PaperList papers={papers} showCount />);

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

      renderWithRouter(<PaperList papers={papers} whyReadMap={whyReadMap} />);

      expect(screen.getByText("最新の機械学習手法を理解できます")).toBeInTheDocument();
      expect(screen.getByText("データ分析の効率化に役立ちます")).toBeInTheDocument();
    });

    it("正常系: whyReadMapが空でもエラーにならない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = [createSamplePaper("2401.00001", "Paper 1")];

      renderWithRouter(<PaperList papers={papers} whyReadMap={new Map()} />);

      expect(screen.getByText("Paper 1")).toBeInTheDocument();
    });
  });

  describe("無限スクロール（スクロールイベント）", () => {
    /**
     * スクロールイベントをシミュレートするヘルパー
     * 仮想スクロールコンテナ内でスクロール末尾に近づいた状態をシミュレート
     */
    const simulateScrollNearBottom = (container: HTMLElement) => {
      // scrollHeight, clientHeight, scrollTop をモック
      Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(container, "clientHeight", { value: 800, configurable: true });
      Object.defineProperty(container, "scrollTop", { value: 1100, configurable: true }); // 2000 - 800 - 1100 = 100 < 300

      // スクロールイベントを発火
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    };

    it("正常系: スクロール末尾に到達するとonRequestSyncが呼ばれる", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      renderWithRouter(<PaperList papers={papers} onRequestSync={onRequestSync} />);

      // 仮想スクロールコンテナを取得（overflow-auto を持つ要素）
      const scrollContainer = document.querySelector(".overflow-auto");
      expect(scrollContainer).not.toBeNull();

      // スクロール末尾に近づいた状態をシミュレート
      act(() => {
        simulateScrollNearBottom(scrollContainer as HTMLElement);
      });

      expect(onRequestSync).toHaveBeenCalledTimes(1);
    });

    it("正常系: isSyncingがtrueの場合はonRequestSyncが呼ばれない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      renderWithRouter(
        <PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={true} />
      );

      // 仮想スクロールコンテナを取得
      const scrollContainer = document.querySelector(".overflow-auto");
      expect(scrollContainer).not.toBeNull();

      // スクロール末尾に近づいた状態をシミュレート
      act(() => {
        simulateScrollNearBottom(scrollContainer as HTMLElement);
      });

      // isSyncing が true なので呼ばれない
      expect(onRequestSync).not.toHaveBeenCalled();
    });

    it("バグ修正: ページリロード直後はスクロールなしでonRequestSyncが発火しない", async () => {
      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      // 初回レンダリング（isSyncing: false）
      renderWithRouter(
        <PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={false} />
      );

      // microtask を処理
      await act(async () => {
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      });

      // スクロールイベントなしでは onRequestSync は呼ばれない
      // （以前の IntersectionObserver ベースの実装では、初回レンダリング時に発火していた）
      expect(onRequestSync).not.toHaveBeenCalled();
    });
  });
});
