import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Paper } from "../../shared/schemas";

/**
 * フィルターモード
 * - all: すべての論文
 * - liked: いいねした論文のみ
 * - bookmarked: ブックマークした論文のみ
 */
export type FilterMode = "all" | "liked" | "bookmarked";

/** URLパラメータのキー */
const PARAM_KEYS = {
  QUERY: "q",
  FILTER: "filter",
  CATEGORY: "cat",
} as const;

/**
 * usePaperFilter の返り値の型
 */
interface UsePaperFilterResult {
  /** 現在の検索クエリ（null = 検索なし） */
  searchQuery: string | null;
  /** 現在のフィルターモード */
  filterMode: FilterMode;
  /** 選択中のカテゴリセット */
  selectedCategories: Set<string>;
  /** 検索クエリを設定 */
  setSearchQuery: (query: string | null) => void;
  /** フィルターモードを設定 */
  setFilterMode: (mode: FilterMode) => void;
  /** フィルターモードをトグル（同じモードを選択したらallに戻す） */
  toggleFilterMode: (mode: FilterMode) => void;
  /** カテゴリの選択/解除をトグル */
  toggleCategory: (category: string) => void;
  /** すべてのフィルターをクリア */
  clearAllFilters: () => void;
  /** 論文をフィルタリング */
  filterPapers: (
    papers: Paper[],
    likedPaperIds: Set<string>,
    bookmarkedPaperIds: Set<string>
  ) => Paper[];
}

/**
 * usePaperFilter - フィルター状態をURL（SearchParams）で管理するフック
 *
 * 原則1「状態の外部化」に従い、フィルター状態をURLで管理する。
 * これにより以下のメリットが得られる:
 * - リロード後も状態が保持される
 * - URL共有で同じフィルター状態を再現できる
 * - ブラウザの戻る/進むで状態を遷移できる
 *
 * @example
 * ```tsx
 * const { searchQuery, filterMode, setSearchQuery, filterPapers } = usePaperFilter();
 *
 * // URLは以下のような形式:
 * // /?q=machine+learning&filter=liked&cat=cs.AI&cat=cs.LG
 * ```
 */
export const usePaperFilter = (): UsePaperFilterResult => {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL から状態を読み取り
  const searchQuery = searchParams.get(PARAM_KEYS.QUERY);

  const filterMode = useMemo((): FilterMode => {
    const value = searchParams.get(PARAM_KEYS.FILTER);
    if (value === "liked" || value === "bookmarked") {
      return value;
    }
    return "all";
  }, [searchParams]);

  const selectedCategories = useMemo((): Set<string> => {
    return new Set(searchParams.getAll(PARAM_KEYS.CATEGORY));
  }, [searchParams]);

  /**
   * 検索クエリを設定
   */
  const setSearchQuery = useCallback(
    (query: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (query) {
            next.set(PARAM_KEYS.QUERY, query);
          } else {
            next.delete(PARAM_KEYS.QUERY);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /**
   * フィルターモードを設定
   */
  const setFilterMode = useCallback(
    (mode: FilterMode) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (mode === "all") {
            next.delete(PARAM_KEYS.FILTER);
          } else {
            next.set(PARAM_KEYS.FILTER, mode);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /**
   * フィルターモードをトグル（同じモードを選択したらallに戻す）
   */
  const toggleFilterMode = useCallback(
    (mode: FilterMode) => {
      setFilterMode(filterMode === mode ? "all" : mode);
    },
    [filterMode, setFilterMode]
  );

  /**
   * カテゴリの選択/解除をトグル
   */
  const toggleCategory = useCallback(
    (category: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const currentCategories = next.getAll(PARAM_KEYS.CATEGORY);

          // カテゴリを一度すべて削除
          next.delete(PARAM_KEYS.CATEGORY);

          // トグル後のカテゴリを追加
          const hasCategory = currentCategories.includes(category);
          const newCategories = hasCategory
            ? currentCategories.filter((c) => c !== category)
            : [...currentCategories, category];

          for (const cat of newCategories) {
            next.append(PARAM_KEYS.CATEGORY, cat);
          }

          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /**
   * すべてのフィルターをクリア
   */
  const clearAllFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(PARAM_KEYS.QUERY);
        next.delete(PARAM_KEYS.FILTER);
        next.delete(PARAM_KEYS.CATEGORY);
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  /**
   * 論文をフィルタリングする純粋関数
   */
  const filterPapers = useCallback(
    (papers: Paper[], likedPaperIds: Set<string>, bookmarkedPaperIds: Set<string>): Paper[] => {
      // Step 1: いいね/ブックマークフィルター
      const interactionFiltered =
        filterMode === "liked"
          ? papers.filter((paper) => likedPaperIds.has(paper.id))
          : filterMode === "bookmarked"
            ? papers.filter((paper) => bookmarkedPaperIds.has(paper.id))
            : papers;

      // Step 2: カテゴリフィルター（AND条件: 選択したすべてのカテゴリを含む論文のみ）
      if (selectedCategories.size === 0) {
        return interactionFiltered;
      }

      return interactionFiltered.filter((paper) =>
        [...selectedCategories].every((cat) => paper.categories.includes(cat))
      );
    },
    [filterMode, selectedCategories]
  );

  return {
    searchQuery,
    filterMode,
    selectedCategories,
    setSearchQuery,
    setFilterMode,
    toggleFilterMode,
    toggleCategory,
    clearAllFilters,
    filterPapers,
  };
};
