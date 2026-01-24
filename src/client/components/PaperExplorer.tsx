import { Bookmark, Heart, X } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import { CategoryFilter } from "./CategoryFilter.js";
import { PaperList } from "./PaperList.js";
import { PaperSearch } from "./PaperSearch.js";
import { Button } from "./ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { useInteractionContext } from "../contexts/InteractionContext.js";
import { usePaperFilter } from "../hooks/usePaperFilter.js";
import { cn } from "../lib/utils.js";
import type { Paper } from "../../shared/schemas/index.js";

/**
 * PaperExplorer コンポーネントのProps
 */
interface PaperExplorerProps {
  /** 初期論文データ */
  initialPapers?: Paper[];
  /** 検索実行時のコールバック */
  onSearch?: (query: string) => Promise<Paper[]>;
  /** 検索クリア時のコールバック */
  onClear?: () => void;
  /** 論文クリック時のコールバック */
  onPaperClick?: (paper: Paper) => void;
  /** 外部から設定される検索クエリ（検索履歴からの再検索用） */
  externalQuery?: string | null;
  /** 論文ID → whyRead のマップ */
  whyReadMap?: Map<string, string>;
  /** 追加同期リクエスト時のコールバック */
  onRequestSync?: () => void;
  /** 同期中フラグ */
  isSyncing?: boolean;
  /** 現在展開中の論文ID */
  expandedPaperId?: string | null;
  /** 展開中の論文の詳細コンテンツをレンダリング */
  renderExpandedDetail?: (paper: Paper) => ReactNode;
}

/**
 * PaperExplorer - 論文検索・一覧統合コンポーネント
 *
 * Design Docsに基づく機能:
 * - 検索ボックス
 * - 論文リスト表示
 * - 検索結果の表示
 */
export const PaperExplorer: FC<PaperExplorerProps> = ({
  initialPapers = [],
  onSearch,
  onClear,
  onPaperClick,
  externalQuery = null,
  whyReadMap = new Map(),
  onRequestSync,
  isSyncing = false,
  expandedPaperId = null,
  renderExpandedDetail,
}) => {
  // Context経由でいいね/ブックマーク状態を取得
  const { likedPaperIds, bookmarkedPaperIds } = useInteractionContext();

  // URL状態管理フック（原則1: 状態の外部化）
  const {
    searchQuery,
    filterMode,
    selectedCategories,
    setSearchQuery,
    toggleFilterMode,
    toggleCategory,
    clearAllFilters,
    filterPapers,
  } = usePaperFilter();

  // 論文とローディング状態（親コンポーネントとの連携が必要なためローカルstate）
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [isLoading, setIsLoading] = useState(false);

  // initialPapers が変更されたら papers state を更新
  useEffect(() => {
    setPapers(initialPapers);
  }, [initialPapers]);

  // ストックしてある論文（initialPapers）から利用可能なカテゴリを抽出
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const paper of initialPapers) {
      for (const cat of paper.categories) {
        categories.add(cat);
      }
    }
    // ソートして返す
    return [...categories].sort();
  }, [initialPapers]);

  // カテゴリ + いいね/ブックマークでフィルタリングした論文リスト
  const filteredPapers = useMemo(
    () => filterPapers(papers, likedPaperIds, bookmarkedPaperIds),
    [papers, filterPapers, likedPaperIds, bookmarkedPaperIds]
  );

  // いいね/ブックマークの件数
  const likedCount = papers.filter((p) => likedPaperIds.has(p.id)).length;
  const bookmarkedCount = papers.filter((p) => bookmarkedPaperIds.has(p.id)).length;

  // externalQuery が変更されたら URL の searchQuery を同期（検索履歴からの再検索用）
  useEffect(() => {
    if (externalQuery !== null) {
      setSearchQuery(externalQuery);
    }
  }, [externalQuery, setSearchQuery]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setIsLoading(true);

    try {
      if (onSearch) {
        const results = await onSearch(query);
        setPapers(results);
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 検索をクリアして初期状態に戻す
   */
  const handleClear = () => {
    setSearchQuery(null);
    setPapers(initialPapers);
    clearAllFilters(); // URLフィルターもクリア
    onClear?.();
  };

  // タイトルの決定
  const title = searchQuery ? `"${searchQuery}" の検索結果` : "論文を探す";

  // 検索後かどうか
  const hasSearched = searchQuery !== null;

  return (
    <div className="space-y-4">
      {/* Hero Search Section */}
      <section className="space-y-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight lg:text-2xl">
              <span className="bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {title}
              </span>
            </h2>
            {hasSearched && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                クリア
              </Button>
            )}
          </div>
          {!hasSearched && (
            <p className="text-muted-foreground/50 text-xs lg:text-sm">
              キーワードや質問を入力して、関連する論文を見つけましょう
            </p>
          )}
        </div>

        {/* 検索ボックス */}
        <PaperSearch onSearch={handleSearch} isLoading={isLoading} />

        {/* フィルター（論文がある場合のみ表示） */}
        {papers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {/* いいね/ブックマークフィルター */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60 text-xs mr-1">表示:</span>

              {/* いいねフィルター */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleFilterMode("liked")}
                    className={cn(
                      "h-7 px-2.5 gap-1.5 transition-all",
                      filterMode === "liked"
                        ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 hover:text-rose-500"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    disabled={likedCount === 0}
                  >
                    <Heart
                      className={cn("h-3.5 w-3.5", filterMode === "liked" && "fill-current")}
                    />
                    <span className="text-xs">{likedCount}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {filterMode === "liked" ? "すべての論文を表示" : "いいねした論文のみ表示"}
                </TooltipContent>
              </Tooltip>

              {/* ブックマークフィルター */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleFilterMode("bookmarked")}
                    className={cn(
                      "h-7 px-2.5 gap-1.5 transition-all",
                      filterMode === "bookmarked"
                        ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-500"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    disabled={bookmarkedCount === 0}
                  >
                    <Bookmark
                      className={cn("h-3.5 w-3.5", filterMode === "bookmarked" && "fill-current")}
                    />
                    <span className="text-xs">{bookmarkedCount}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {filterMode === "bookmarked"
                    ? "すべての論文を表示"
                    : "ブックマークした論文のみ表示"}
                </TooltipContent>
              </Tooltip>
            </div>

            {/* カテゴリフィルター（カテゴリが2つ以上ある場合） */}
            {availableCategories.length > 1 && (
              <>
                <div className="h-4 w-px bg-border/50" />
                <CategoryFilter
                  availableCategories={availableCategories}
                  selectedCategories={selectedCategories}
                  onToggle={toggleCategory}
                  onClear={clearAllFilters}
                />
              </>
            )}
          </div>
        )}
      </section>

      {/* 論文リスト */}
      <PaperList
        papers={filteredPapers}
        isLoading={isLoading}
        showCount={hasSearched && !isLoading && filteredPapers.length > 0}
        onPaperClick={onPaperClick}
        whyReadMap={whyReadMap}
        // 検索結果表示中、カテゴリフィルタ中、いいね/ブックマークフィルタ中は追加読み込みを無効化
        onRequestSync={
          hasSearched || selectedCategories.size > 0 || filterMode !== "all"
            ? undefined
            : onRequestSync
        }
        isSyncing={isSyncing}
        // インライン展開
        expandedPaperId={expandedPaperId}
        renderExpandedDetail={renderExpandedDetail}
      />
    </div>
  );
};
