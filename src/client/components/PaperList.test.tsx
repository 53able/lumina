/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Paper } from "@/shared/schemas";

/**
 * PaperList テスト
 *
 * Design Docsに基づく仕様:
 * - 論文カードのリスト表示
 * - 空の場合のメッセージ表示
 * - ローディング状態の表示
 * - 無限スクロール（IntersectionObserver）
 */

/**
 * IntersectionObserverのモック
 * - observe() で監視を開始
 * - disconnect() で監視を終了
 * - triggerIntersect() で intersection イベントを発火
 *
 * @param autoFireOnObserve - true の場合、observe() 呼び出し時に即座に isIntersecting: true で発火
 *                           （実際のブラウザでは要素が visible な場合にこの挙動になる）
 */
interface MockIntersectionObserverInstance {
  observe: Mock;
  disconnect: Mock;
  unobserve: Mock;
  takeRecords: Mock;
  root: Element | null;
  rootMargin: string;
  thresholds: readonly number[];
  callback: IntersectionObserverCallback;
}

const createMockIntersectionObserver = (
  options: { autoFireOnObserve?: boolean } = {}
): {
  MockObserver: typeof IntersectionObserver;
  instances: MockIntersectionObserverInstance[];
  triggerIntersect: (isIntersecting: boolean) => void;
} => {
  const { autoFireOnObserve = false } = options;
  const instances: MockIntersectionObserverInstance[] = [];

  // クラスとして定義することでコンストラクタとして使用可能
  class MockObserver implements IntersectionObserver {
    disconnect = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn(() => []);
    root: Element | null = null;
    rootMargin = "0px";
    thresholds: readonly number[] = [0];
    callback: IntersectionObserverCallback;

    // observe() が呼ばれたときに autoFireOnObserve が true なら即座に発火
    observe = vi.fn(() => {
      if (autoFireOnObserve) {
        // 次の tick で発火（React の useEffect 後）
        queueMicrotask(() => {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
        });
      }
    });

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }
  }

  const triggerIntersect = (isIntersecting: boolean) => {
    const latestInstance = instances[instances.length - 1];
    if (latestInstance) {
      latestInstance.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        latestInstance as unknown as IntersectionObserver
      );
    }
  };

  return {
    MockObserver: MockObserver as unknown as typeof IntersectionObserver,
    instances,
    triggerIntersect,
  };
};

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

  describe("無限スクロール（IntersectionObserver）", () => {
    let originalIntersectionObserver: typeof IntersectionObserver;

    beforeEach(() => {
      // IntersectionObserver をモックに置き換え
      originalIntersectionObserver = global.IntersectionObserver;
    });

    afterEach(() => {
      // 元に戻す
      global.IntersectionObserver = originalIntersectionObserver;
    });

    it("正常系: スクロール末尾に到達するとonRequestSyncが呼ばれる", async () => {
      const { MockObserver, triggerIntersect } = createMockIntersectionObserver();
      global.IntersectionObserver = MockObserver;

      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      render(<PaperList papers={papers} onRequestSync={onRequestSync} />);

      // ローダー要素が visible になったことをシミュレート
      act(() => {
        triggerIntersect(true);
      });

      expect(onRequestSync).toHaveBeenCalledTimes(1);
    });

    it("正常系: isSyncingがtrueの場合はonRequestSyncが呼ばれない", async () => {
      const { MockObserver, triggerIntersect } = createMockIntersectionObserver();
      global.IntersectionObserver = MockObserver;

      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      render(<PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={true} />);

      // ローダー要素が visible になったことをシミュレート
      act(() => {
        triggerIntersect(true);
      });

      expect(onRequestSync).not.toHaveBeenCalled();
    });

    it("バグ修正: isSyncingがtrue→falseに変化しても、スクロールなしでonRequestSyncが連続発火しない", async () => {
      // autoFireOnObserve: true で、observe() 時に即座に発火するモックを使用
      // これは「ローダー要素が常に viewport 内にある」状況をシミュレート
      const { MockObserver, instances } = createMockIntersectionObserver({
        autoFireOnObserve: true,
      });
      global.IntersectionObserver = MockObserver;

      const { PaperList } = await import("./PaperList");
      const papers = Array.from({ length: 50 }, (_, i) =>
        createSamplePaper(`2401.${String(i).padStart(5, "0")}`, `Paper ${i + 1}`)
      );
      const onRequestSync = vi.fn();

      // 初回レンダリング（isSyncing: false）
      // autoFireOnObserve により、observe() 時点で isIntersecting: true が発火
      const { rerender } = render(
        <PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={false} />
      );

      // microtask を処理（observe() 後のコールバック発火を待つ）
      await act(async () => {
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      });

      // 最初の observe() で onRequestSync が呼ばれる
      const initialCallCount = onRequestSync.mock.calls.length;
      expect(initialCallCount).toBe(1);

      // observer の数を記録
      const observerCountAfterInitial = instances.length;

      // isSyncing: true に変化（同期開始）
      rerender(<PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={true} />);

      // microtask を処理
      await act(async () => {
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      });

      // isSyncing: false に戻る（同期完了）
      rerender(<PaperList papers={papers} onRequestSync={onRequestSync} isSyncing={false} />);

      // microtask を処理（新しい observer の observe() 後のコールバック発火を待つ）
      await act(async () => {
        await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      });

      // observer が再作成されたかチェック
      const observerCountAfterSyncingFalse = instances.length;
      const observerWasRecreated = observerCountAfterSyncingFalse > observerCountAfterInitial;

      // 🔴 バグの検出：
      // 現在の実装では isSyncing が依存配列にあるため、observer が再作成される
      // そして autoFireOnObserve により、再作成時に即座に onRequestSync が呼ばれてしまう
      //
      // 期待動作: observer が再作成されないか、再作成されても連続発火しない
      if (observerWasRecreated) {
        // observer が再作成された場合でも、onRequestSync は1回だけであるべき
        expect(onRequestSync).toHaveBeenCalledTimes(1);
      } else {
        // observer が再作成されなかった場合、それが正しい修正
        expect(onRequestSync).toHaveBeenCalledTimes(1);
      }
    });
  });
});
