import { Bookmark, Heart, X } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import { CategoryFilter } from "@/client/components/CategoryFilter";
import { PaperList } from "@/client/components/PaperList";
import { PaperSearch } from "@/client/components/PaperSearch";
import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import type { Paper } from "@/shared/schemas";

/** フィルターモード */
type FilterMode = "all" | "liked" | "bookmarked";

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
  /** いいねボタンクリック時のコールバック */
  onLike?: (paperId: string) => void;
  /** ブックマークボタンクリック時のコールバック */
  onBookmark?: (paperId: string) => void;
  /** いいね済みの論文IDセット */
  likedPaperIds?: Set<string>;
  /** ブックマーク済みの論文IDセット */
  bookmarkedPaperIds?: Set<string>;
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
  onLike,
  onBookmark,
  likedPaperIds = new Set(),
  bookmarkedPaperIds = new Set(),
  externalQuery = null,
  whyReadMap = new Map(),
  onRequestSync,
  isSyncing = false,
  expandedPaperId = null,
  renderExpandedDetail,
}) => {
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

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
  const filteredPapers = useMemo(() => {
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
  }, [papers, selectedCategories, filterMode, likedPaperIds, bookmarkedPaperIds]);

  /**
   * フィルターモードのトグル
   */
  const handleFilterModeToggle = (mode: FilterMode) => {
    setFilterMode((prev) => (prev === mode ? "all" : mode));
  };

  // いいね/ブックマークの件数
  const likedCount = papers.filter((p) => likedPaperIds.has(p.id)).length;
  const bookmarkedCount = papers.filter((p) => bookmarkedPaperIds.has(p.id)).length;

  /**
   * カテゴリ選択/解除のトグル
   */
  const handleCategoryToggle = (category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  /**
   * カテゴリフィルタをクリア
   */
  const handleCategoryClear = () => {
    setSelectedCategories(new Set());
  };

  // externalQuery が変更されたら searchQuery state を同期（検索履歴からの再検索用）
  useEffect(() => {
    if (externalQuery !== null) {
      setSearchQuery(externalQuery);
    }
  }, [externalQuery]);

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
    setSelectedCategories(new Set()); // カテゴリフィルタもクリア
    setFilterMode("all"); // いいね/ブックマークフィルタもクリア
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
                    onClick={() => handleFilterModeToggle("liked")}
                    className={cn(
                      "h-7 px-2.5 gap-1.5 transition-all",
                      filterMode === "liked"
                        ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 hover:text-rose-500"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    disabled={likedCount === 0}
                  >
                    <Heart
                      className={cn(
                        "h-3.5 w-3.5",
                        filterMode === "liked" && "fill-current"
                      )}
                    />
                    <span className="text-xs">{likedCount}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {filterMode === "liked"
                    ? "すべての論文を表示"
                    : "いいねした論文のみ表示"}
                </TooltipContent>
              </Tooltip>

              {/* ブックマークフィルター */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleFilterModeToggle("bookmarked")}
                    className={cn(
                      "h-7 px-2.5 gap-1.5 transition-all",
                      filterMode === "bookmarked"
                        ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-500"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    disabled={bookmarkedCount === 0}
                  >
                    <Bookmark
                      className={cn(
                        "h-3.5 w-3.5",
                        filterMode === "bookmarked" && "fill-current"
                      )}
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
                  onToggle={handleCategoryToggle}
                  onClear={handleCategoryClear}
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
        onLike={onLike}
        onBookmark={onBookmark}
        likedPaperIds={likedPaperIds}
        bookmarkedPaperIds={bookmarkedPaperIds}
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
