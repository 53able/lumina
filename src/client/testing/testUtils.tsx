/**
 * テストユーティリティ
 *
 * Contextプロバイダーをラップしたレンダリングヘルパーを提供する。
 */
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { InteractionProvider } from "@/client/contexts/InteractionContext";

/**
 * InteractionContextのモック値の型
 */
interface MockInteractionContextValue {
  /** いいね済み論文IDのSet */
  likedPaperIds?: Set<string>;
  /** ブックマーク済み論文IDのSet */
  bookmarkedPaperIds?: Set<string>;
  /** toggleLikeのモック関数 */
  toggleLike?: (paperId: string) => void;
  /** toggleBookmarkのモック関数 */
  toggleBookmark?: (paperId: string) => void;
}

/**
 * カスタムレンダリングオプション
 */
interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  /** 初期ルートパス */
  initialRoute?: string;
  /** InteractionContextのモック値 */
  interactionContext?: MockInteractionContextValue;
}

/**
 * すべてのプロバイダーをラップしたレンダリングヘルパー
 *
 * @param ui - レンダリングするコンポーネント
 * @param options - カスタムオプション
 */
export const renderWithProviders = (ui: ReactNode, options: CustomRenderOptions = {}) => {
  const { initialRoute = "/", ...renderOptions } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialRoute]}>
      <InteractionProvider>{children}</InteractionProvider>
    </MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

/**
 * ルーターのみをラップしたレンダリングヘルパー
 *
 * InteractionContextが不要な場合に使用
 */
export const renderWithRouter = (ui: ReactNode, options: CustomRenderOptions = {}) => {
  const { initialRoute = "/", ...renderOptions } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};
