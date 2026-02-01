import { Bookmark, Heart, SlidersHorizontal, X } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import type { Paper } from "../../shared/schemas/index";
import { useInteractionContext } from "../contexts/InteractionContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePaperFilter } from "../hooks/usePaperFilter";
import { cn } from "../lib/utils";
import { usePaperStore } from "../stores/paperStore";
import { CategoryFilter } from "./CategoryFilter";
import { PaperList } from "./PaperList";
import { PaperSearch } from "./PaperSearch";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet.js";
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
  /** 検索0件時に表示するメッセージ（APIキー未設定など理由がある場合） */
  emptySearchMessage?: ReactNode;
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
  emptySearchMessage,
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

  // 検索していないときは searchResultPapers を空にしておく（再検索時に 2461 件フラッシュ→0 件になる不具合を防ぐ）
  useEffect(() => {
    if (!hasSearched) setSearchResultPapers([]);
  }, [hasSearched]);

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
    setSearchResultPapers([]); // 新規検索開始時は一旦空にし、前回の一覧がフラッシュしないようにする

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
    setSearchResultPapers([]); // クリア時は空にし、再検索時の表示ブレを防ぐ
    clearAllFilters(); // URLフィルターもクリア
    onClear?.();
    // モバイル: 検索結果→一覧に戻ったときメインのスクロール位置を先頭に戻す（レイアウト崩れ防止）
    requestAnimationFrame(() => {
      document.querySelector("main")?.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  // タイトルの決定
  const title = searchQuery ? `"${searchQuery}" の検索結果` : "論文を探す";

  // モバイル: 論文一覧をファーストビューに近づける（オブジェクトファースト）
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // モバイル: 絞り込みをSheetに集約（開閉状態）
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // 有効なフィルター数（バッジ表示用）
  const activeFilterCount =
    (filterMode !== "all" ? 1 : 0) + selectedCategories.size;

  const showFilterArea =
    displayPapers.length > 0 || filterMode !== "all" || selectedCategories.size > 0;

  return (
    <div className={cn("space-y-6", !isDesktop && "space-y-4")}>
      {/* Hero Search Section - モバイルではコンパクトにして一覧までの距離を短く */}
      <section className={cn("space-y-4", !isDesktop && "space-y-3")}>
        <div className={cn("space-y-2", !isDesktop && "space-y-1")}>
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className={cn(
                "min-w-0 truncate text-xl font-bold tracking-tight lg:text-2xl",
                !isDesktop && "text-lg"
              )}
            >
              <span className="bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {title}
              </span>
            </h2>
            {hasSearched && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className={cn(
                  "h-7 px-2 text-muted-foreground hover:text-foreground",
                  !isDesktop && "h-6 px-1.5"
                )}
              >
                <X className={cn("mr-2 h-4 w-4", !isDesktop && "mr-1 h-3.5 w-3.5")} />
                {isDesktop ? "クリア" : ""}
              </Button>
            )}
          </div>
          {/* モバイルでは説明を非表示にして一覧を上に */}
          {!hasSearched && isDesktop && (
            <p className="text-muted-foreground/50 text-xs lg:text-sm">
              キーワードや質問を入力して、関連する論文を見つけましょう
            </p>
          )}
        </div>

        {/* 検索ボックス（モバイルでも1行のまま） */}
        <PaperSearch onSearch={handleSearch} isLoading={isLoading} />

        {/* 絞り込み: モバイルは「フィルター」ボタン＋Sheet、デスクトップはインラインコンパクト */}
        {showFilterArea && (
          <>
            {!isDesktop ? (
              /* モバイル: 1ボタンでSheetを開く（論文一覧までの距離を短く） */
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFilterSheetOpen(true)}
                  className="h-8 gap-1.5 px-3 text-sm"
                  aria-label="絞り込みを開く"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  フィルター
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-xs font-medium text-primary">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </div>
            ) : (
              /* デスクトップ: インラインコンパクト（ラベル省略・余白縮小） */
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {/* いいね/ブックマーク */}
                <fieldset className="flex items-center gap-1.5 border-0 p-0 m-0 min-w-0">
                  <legend className="sr-only">表示</legend>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleFilterMode("liked")}
                        className={cn(
                          "h-7 px-2 gap-1 transition-all",
                          filterMode === "liked"
                            ? "bg-primary/10 text-primary hover:bg-primary/20"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        disabled={likedCount === 0 && filterMode !== "liked"}
                        aria-pressed={filterMode === "liked"}
                        aria-label={
                          filterMode === "liked"
                            ? "すべての論文を表示"
                            : "いいねした論文のみ表示"
                        }
                      >
                        <Heart className={cn("h-3.5 w-3.5", filterMode === "liked" && "fill-current")} />
                        <span className="text-xs">{likedCount}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {filterMode === "liked" ? "すべての論文を表示" : "いいねした論文のみ表示"}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleFilterMode("bookmarked")}
                        className={cn(
                          "h-7 px-2 gap-1 transition-all",
                          filterMode === "bookmarked"
                            ? "bg-primary/10 text-primary hover:bg-primary/20"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        disabled={bookmarkedCount === 0 && filterMode !== "bookmarked"}
                        aria-pressed={filterMode === "bookmarked"}
                        aria-label={
                          filterMode === "bookmarked"
                            ? "すべての論文を表示"
                            : "ブックマークした論文のみ表示"
                        }
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
                </fieldset>

                {/* カテゴリ（2つ以上ある場合） */}
                {availableCategories.length > 1 && (
                  <>
                    <div className="h-4 w-px bg-border/50" aria-hidden />
                    <CategoryFilter
                      availableCategories={availableCategories}
                      selectedCategories={selectedCategories}
                      onToggle={toggleCategory}
                      onClear={clearAllFilters}
                      hideLabel
                    />
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* モバイル: 絞り込みSheet */}
        {!isDesktop && (
          <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
            <SheetContent side="bottom" className="rounded-t-xl max-h-[85dvh] flex flex-col">
              <SheetHeader>
                <SheetTitle>絞り込み</SheetTitle>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
                {/* 表示: すべて / いいね / ブックマーク */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">表示</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={filterMode === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilterMode("all")}
                      className="h-8"
                    >
                      すべて
                    </Button>
                    <Button
                      variant={filterMode === "liked" ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilterMode("liked")}
                      disabled={likedCount === 0}
                      className="h-8 gap-1.5"
                    >
                      <Heart className={cn("h-4 w-4", filterMode === "liked" && "fill-current")} />
                      {likedCount}
                    </Button>
                    <Button
                      variant={filterMode === "bookmarked" ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilterMode("bookmarked")}
                      disabled={bookmarkedCount === 0}
                      className="h-8 gap-1.5"
                    >
                      <Bookmark className={cn("h-4 w-4", filterMode === "bookmarked" && "fill-current")} />
                      {bookmarkedCount}
                    </Button>
                  </div>
                </div>

                {/* カテゴリ */}
                {availableCategories.length > 1 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">カテゴリ</p>
                    <CategoryFilter
                      availableCategories={availableCategories}
                      selectedCategories={selectedCategories}
                      onToggle={toggleCategory}
                      onClear={clearAllFilters}
                      hideLabel
                    />
                  </div>
                )}

                {/* クリア */}
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      clearAllFilters();
                      setIsFilterSheetOpen(false);
                    }}
                    className="w-full justify-center text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    絞り込みをクリア
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </section>

      {/* 論文リスト */}
      <PaperList
        papers={filteredPapers}
        isLoading={isLoading}
        emptyMessage={hasSearched && !isLoading && filteredPapers.length === 0 ? emptySearchMessage : undefined}
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
