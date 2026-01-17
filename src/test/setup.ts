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
