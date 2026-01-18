import { createContext, type FC, type ReactNode, useContext, useMemo } from "react";
import { useInteractionStore } from "@/client/stores/interactionStore";

/**
 * 単一論文に対するインタラクション状態
 */
interface PaperInteraction {
  /** いいね済みかどうか */
  isLiked: boolean;
  /** ブックマーク済みかどうか */
  isBookmarked: boolean;
  /** いいねをトグルする */
  toggleLike: () => void;
  /** ブックマークをトグルする */
  toggleBookmark: () => void;
}

/**
 * InteractionContext の値の型
 */
interface InteractionContextValue {
  /** いいね済み論文IDのSet */
  likedPaperIds: Set<string>;
  /** ブックマーク済み論文IDのSet */
  bookmarkedPaperIds: Set<string>;
  /** いいねをトグルする */
  toggleLike: (paperId: string) => void;
  /** ブックマークをトグルする */
  toggleBookmark: (paperId: string) => void;
}

const InteractionContext = createContext<InteractionContextValue | null>(null);

/**
 * InteractionProvider - いいね/ブックマーク状態をコンテキスト経由で提供
 *
 * Props Drillingを解消するため、Zustand storeをContextでラップする。
 * これにより、深いネストのコンポーネントでも直接状態にアクセスできる。
 *
 * @example
 * ```tsx
 * // App.tsx または main.tsx で Provider をラップ
 * <InteractionProvider>
 *   <App />
 * </InteractionProvider>
 *
 * // 子コンポーネントで使用
 * const { isLiked, toggleLike } = useInteraction(paperId);
 * ```
 */
export const InteractionProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { toggleLike, toggleBookmark, getLikedPaperIds, getBookmarkedPaperIds } =
    useInteractionStore();

  // Setを毎回再計算するのを避けるため、storeの状態変化時のみ更新
  const likedPaperIds = getLikedPaperIds();
  const bookmarkedPaperIds = getBookmarkedPaperIds();

  const value = useMemo<InteractionContextValue>(
    () => ({
      likedPaperIds,
      bookmarkedPaperIds,
      toggleLike,
      toggleBookmark,
    }),
    [likedPaperIds, bookmarkedPaperIds, toggleLike, toggleBookmark]
  );

  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
};

/**
 * useInteractionContext - Context から全体の状態を取得
 *
 * @throws Provider外で使用された場合にエラー
 */
export const useInteractionContext = (): InteractionContextValue => {
  const context = useContext(InteractionContext);
  if (!context) {
    throw new Error("useInteractionContext must be used within an InteractionProvider");
  }
  return context;
};

/**
 * useInteraction - 特定の論文に対するインタラクション状態を取得
 *
 * PaperCardなど、単一の論文を扱うコンポーネントで使用する。
 * propsで `isLiked`, `isBookmarked`, `onLike`, `onBookmark` を受け取る代わりに、
 * このフックを使うことでProps Drillingを解消できる。
 *
 * @param paperId - 論文ID
 * @returns 論文に対するインタラクション状態とアクション
 *
 * @example
 * ```tsx
 * const PaperCard: FC<{ paper: Paper }> = ({ paper }) => {
 *   const { isLiked, isBookmarked, toggleLike, toggleBookmark } = useInteraction(paper.id);
 *
 *   return (
 *     <Card>
 *       <Button onClick={toggleLike}>
 *         <Heart fill={isLiked ? "red" : "none"} />
 *       </Button>
 *     </Card>
 *   );
 * };
 * ```
 */
export const useInteraction = (paperId: string): PaperInteraction => {
  const { likedPaperIds, bookmarkedPaperIds, toggleLike, toggleBookmark } = useInteractionContext();

  return useMemo(
    () => ({
      isLiked: likedPaperIds.has(paperId),
      isBookmarked: bookmarkedPaperIds.has(paperId),
      toggleLike: () => toggleLike(paperId),
      toggleBookmark: () => toggleBookmark(paperId),
    }),
    [paperId, likedPaperIds, bookmarkedPaperIds, toggleLike, toggleBookmark]
  );
};
