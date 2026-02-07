/**
 * Vitest グローバルセットアップ
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

/**
 * グローバルfetchのモック
 * テスト中のAPIコール（auto-syncなど）がハングしないようにする
 * vi.clearAllMocks() でリセットされないよう、mockImplementation を使用
 */
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ papers: [] }),
  })
);
global.fetch = mockFetch as unknown as typeof fetch;

/**
 * 各テスト後にモックをリセット
 */
afterEach(() => {
  vi.clearAllMocks();
  // fetch モックを再設定（clearAllMocks でリセットされるため）
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ papers: [] }),
    })
  );
});

/**
 * IntersectionObserver のモック（jsdom には存在しないため）
 */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

global.IntersectionObserver = MockIntersectionObserver;

/**
 * ResizeObserver のモック（jsdom には存在しないため）
 * useGridVirtualizer フックで使用される
 */
class MockResizeObserver implements ResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    // 初期サイズをコールバックに通知（1200px幅を想定）
    // Radix useSize 等は borderBoxSize[0].inlineSize を参照するため、要素を詰める
    const size = { inlineSize: 1200, blockSize: 800 };
    const entry: ResizeObserverEntry = {
      target,
      contentRect: {
        width: 1200,
        height: 800,
        top: 0,
        left: 0,
        bottom: 800,
        right: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      borderBoxSize: [size],
      contentBoxSize: [size],
      devicePixelContentBoxSize: [size],
    };
    // 非同期でコールバックを呼び出し（実際のResizeObserverと同様）
    setTimeout(() => this.callback([entry], this), 0);
  }

  unobserve(): void {}

  disconnect(): void {}
}

global.ResizeObserver = MockResizeObserver;

/**
 * matchMedia のモック（jsdom には存在しないため）
 * useMediaQuery フックで使用される
 * Note: jsdom環境でのみ実行（Node.js環境では window が存在しない）
 */
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
