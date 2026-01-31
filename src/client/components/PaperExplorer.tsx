import { Bookmark, Heart, X } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import type { Paper } from "../../shared/schemas/index";
import { useInteractionContext } from "../contexts/InteractionContext";
import { usePaperFilter } from "../hooks/usePaperFilter";
import { cn } from "../lib/utils";
import { usePaperStore } from "../stores/paperStore";
import { CategoryFilter } from "./CategoryFilter";
import { PaperList } from "./PaperList";
import { PaperSearch } from "./PaperSearch";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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

  // 検索後かどうか（displayPapers の算出に必要なので先に定義）
  const hasSearched = searchQuery !== null;

  // 一覧表示時は store を直接購読（backfill で embedding が付与されても即反映）
  const storePapers = usePaperStore((s) => s.papers);
  // 検索結果用のローカル state（検索時のみ使用）
  const [searchResultPapers, setSearchResultPapers] = useState<Paper[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 検索していないときは store（未ロード時は initialPapers にフォールバック）、検索後は検索結果
  const displayPapers = hasSearched
    ? searchResultPapers
    : storePapers.length > 0
      ? storePapers
      : initialPapers;

  // initialPapers が変更されたら searchResultPapers の初期値を更新（検索クリア時に使う）
  useEffect(() => {
    if (!hasSearched) setSearchResultPapers(initialPapers);
  }, [initialPapers, hasSearched]);

  // ストックしてある論文（表示元）から利用可能なカテゴリを抽出
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const paper of displayPapers) {
      for (const cat of paper.categories) {
        categories.add(cat);
      }
    }
    return [...categories].sort();
  }, [displayPapers]);

  // カテゴリ + いいね/ブックマークでフィルタリングした論文リスト
  const filteredPapers = useMemo(
    () => filterPapers(displayPapers, likedPaperIds, bookmarkedPaperIds),
    [displayPapers, filterPapers, likedPaperIds, bookmarkedPaperIds]
  );

  // いいね/ブックマークの件数
  const likedCount = displayPapers.filter((p) => likedPaperIds.has(p.id)).length;
  const bookmarkedCount = displayPapers.filter((p) => bookmarkedPaperIds.has(p.id)).length;

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
        setSearchResultPapers(results);
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
    setSearchResultPapers(initialPapers);
    clearAllFilters(); // URLフィルターもクリア
    onClear?.();
  };

  // タイトルの決定
  const title = searchQuery ? `"${searchQuery}" の検索結果` : "論文を探す";

  return (
    <div className="space-y-8">
      {/* Hero Search Section - ロジック駆動: 関連要素は近くに、無関係な要素は離す */}
      <section className="space-y-4">
        <div className="space-y-2">
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
                <X className="mr-2 h-4 w-4" />
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

        {/* フィルター（論文がある場合、またはフィルターが有効な場合に表示） */}
        {(displayPapers.length > 0 || filterMode !== "all" || selectedCategories.size > 0) && (
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {/* いいね/ブックマークフィルター */}
            <div className="flex items-center gap-2">
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
                        ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary-light"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    // フィルターが既に有効な場合は解除できるようにする（disabledを解除）
                    disabled={likedCount === 0 && filterMode !== "liked"}
                  >
                    <Heart className={cn("h-4 w-4", filterMode === "liked" && "fill-current")} />
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
                        ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary-light"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    // フィルターが既に有効な場合は解除できるようにする（disabledを解除）
                    disabled={bookmarkedCount === 0 && filterMode !== "bookmarked"}
                  >
                    <Bookmark
                      className={cn("h-4 w-4", filterMode === "bookmarked" && "fill-current")}
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
