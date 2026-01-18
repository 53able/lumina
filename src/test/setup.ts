/**
 * Vitest グローバルセットアップ
 */
import "@testing-library/jest-dom/vitest";

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
