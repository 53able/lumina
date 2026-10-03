import { Bookmark, ChevronDown, Heart, SlidersHorizontal, X } from "lucide-react";
import { type FC, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** 絞り込み結果を読み上げるまでの待ち時間（連続操作で読み上げを連発しない） */
const FILTER_ANNOUNCE_DELAY_MS = 400;

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
  /** 検索が完了したクエリ（URL の q と一致するとき initialPapers を検索結果として表示する） */
  externalQuery?: string | null;
  /** 検索入力欄の値（制御モード時。親で一元管理） */
  searchInputValue?: string;
  /** 検索入力欄の変更コールバック（制御モード時） */
  onSearchInputChange?: (value: string) => void;
  /** 論文ID → whyRead のマップ */
  whyReadMap?: Map<string, string>;
  /** 追加同期リクエスト時のコールバック */
  onRequestSync?: () => void;
  /** 現在展開中の論文ID */
  expandedPaperId?: string | null;
  /** 展開中の論文の詳細コンテンツをレンダリング */
  renderExpandedDetail?: (paper: Paper) => ReactNode;
  /** 検索0件時に表示するメッセージ（APIキー未設定など理由がある場合） */
  emptySearchMessage?: ReactNode;
  /** 検索処理中のローディング状態（useSemanticSearchのisLoading） */
  isSearchLoading?: boolean;
  /** 0件時の「論文を同期」 */
  onSync?: () => void;
  /** 0件時の「同期を再試行」 */
  onRetrySync?: () => void;
  /** 初回の自動同期を予定しているか */
  isSyncPending?: boolean;
  /** 0件時の「設定を開く」 */
  onOpenSettings?: () => void;
  /** 検索結果の件数の隣に置く操作（表示件数を受け取る。検索結果の表示中だけ使う） */
  renderSearchResultTools?: (displayedCount: number) => ReactNode;
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
  searchInputValue,
  onSearchInputChange,
  whyReadMap = new Map(),
  onRequestSync,
  expandedPaperId = null,
  renderExpandedDetail,
  emptySearchMessage,
  isSearchLoading = false,
  onSync,
  onRetrySync,
  isSyncPending,
  onOpenSettings,
  renderSearchResultTools,
}) => {
  // Context経由でいいね/ブックマーク状態を取得
  const { likedPaperIds, bookmarkedPaperIds } = useInteractionContext();

  // URL状態管理フック（原則1: 状態の外部化）
  const {
    searchQuery,
    filterMode,
    selectedCategories,
    toggleFilterMode,
    toggleCategory,
    clearAllFilters,
    clearSearchAndFilters,
    filterPapers,
  } = usePaperFilter();

  // 検索後かどうか（displayPapers の算出に必要なので先に定義）
  const hasSearched = searchQuery !== null;

  // 一覧表示時は store を直接購読（backfill で embedding が付与されても即反映）
  const storePapers = usePaperStore((s) => s.papers);
  // 検索結果用のローカル state（検索時のみ使用）
  const [searchResultPapers, setSearchResultPapers] = useState<Paper[]>([]);
  // 検索の世代（クリアや後続検索の後に届いた古い結果を採用しない）
  const searchGenerationRef = useRef(0);

  // 検索結果の表示元: 検索履歴クリックなど「外部からクエリが指定された」場合は親の initialPapers を使用
  // React Best Practice: 表示用は render 内で派生。effect で searchResultPapers をクリアしない（rerender-derived-state-no-effect）
  const isExternalSearch = externalQuery !== null && searchQuery?.trim() === externalQuery;
  const displayPapers = hasSearched
    ? isExternalSearch
      ? initialPapers
      : searchResultPapers
    : storePapers.length > 0
      ? storePapers
      : initialPapers;

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
  const { likedCount, bookmarkedCount } = useMemo(() => {
    let likedCount = 0;
    let bookmarkedCount = 0;
    for (const paper of displayPapers) {
      if (likedPaperIds.has(paper.id)) likedCount += 1;
      if (bookmarkedPaperIds.has(paper.id)) bookmarkedCount += 1;
    }
    return { likedCount, bookmarkedCount };
  }, [displayPapers, likedPaperIds, bookmarkedPaperIds]);

  // URL（q）の更新は onSearch 側（useHomeSearch）が担う。ここで更新すると URL 監視による検索と二重実行になる
  const handleSearch = async (query: string) => {
    const generation = ++searchGenerationRef.current;
    setSearchResultPapers([]); // 新規検索開始時は一旦空にし、前回の一覧がフラッシュしないようにする

    if (onSearch) {
      const results = await onSearch(query);
      if (generation === searchGenerationRef.current) {
        setSearchResultPapers(results);
      }
    }
  };

  /**
   * 検索をクリアして初期状態に戻す
   */
  const handleClear = () => {
    searchGenerationRef.current += 1;
    setSearchResultPapers([]); // クリア時は空にし、再検索時の表示ブレを防ぐ
    clearSearchAndFilters(); // URLの検索語とフィルターもクリア
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

  // モバイル: 一覧の手前の折りたたみ式絞り込み領域（開閉状態）
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const filterPanelId = useId();
  const filterToggleRef = useRef<HTMLButtonElement>(null);

  // 有効なフィルター数（バッジ表示用）
  const activeFilterCount = (filterMode !== "all" ? 1 : 0) + selectedCategories.size;

  // 適用中の条件（モバイルで折りたたみ中も確認できるように表示）
  const activeConditionLabels = [
    ...(filterMode === "liked" ? ["いいね"] : filterMode === "bookmarked" ? ["ブックマーク"] : []),
    ...selectedCategories,
  ];

  const showFilterArea =
    displayPapers.length > 0 || filterMode !== "all" || selectedCategories.size > 0;

  // 絞り込み結果の通知: 利用者が条件を変えたときだけ、操作が落ち着いてから1回読み上げる。
  // 同期による追加や検索で件数が変わっても読み上げない（表示用の件数は live region にしない）
  const [filterAdjustment, setFilterAdjustment] = useState(0);
  const announcedAdjustmentRef = useRef(0);
  const [filterAnnouncement, setFilterAnnouncement] = useState("");
  // 文言はしきい値の通知（SearchThresholdControl）と揃える。通知のきっかけは別（あちらはスライダー操作のみ）
  const filterAnnouncementText = `${activeConditionLabels.join("・") || "絞り込みなし"}: ${filteredPapers.length}件の論文を表示`;
  // 別の検索に移ったら、前の検索で出した通知を残さない
  const [announcementQuery, setAnnouncementQuery] = useState(searchQuery);
  if (announcementQuery !== searchQuery) {
    setAnnouncementQuery(searchQuery);
    setFilterAnnouncement("");
  }
  useEffect(() => {
    if (filterAdjustment === announcedAdjustmentRef.current) return;
    if (isSearchLoading) {
      // 検索中の件数は確定していないため通知しない
      announcedAdjustmentRef.current = filterAdjustment;
      return;
    }
    const timer = setTimeout(() => {
      announcedAdjustmentRef.current = filterAdjustment;
      setFilterAnnouncement(filterAnnouncementText);
    }, FILTER_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filterAdjustment, filterAnnouncementText, isSearchLoading]);
  const markFilterAdjusted = () => setFilterAdjustment((n) => n + 1);

  // モバイル: 条件を解除すると押したボタンが消えるため、フォーカスを開閉ボタンへ移して見失わせない
  const clearFiltersFromPanel = () => {
    clearAllFilters();
    markFilterAdjusted();
    filterToggleRef.current?.focus();
  };

  // 選択中（展開中）の論文が絞り込みで一覧から外れたか
  const isExpandedPaperFilteredOut =
    expandedPaperId !== null &&
    displayPapers.some((paper) => paper.id === expandedPaperId) &&
    !filteredPapers.some((paper) => paper.id === expandedPaperId);

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
            {hasSearched ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                aria-label="検索と絞り込みをクリア"
                className={cn(
                  "h-7 px-2 text-muted-foreground hover:text-foreground",
                  !isDesktop ? "h-6 px-1.5" : ""
                )}
              >
                <X className={cn("mr-2 h-4 w-4", !isDesktop ? "mr-1 h-3.5 w-3.5" : "")} />
                {isDesktop ? "クリア" : ""}
              </Button>
            ) : null}
          </div>
          {/* モバイルでは説明を非表示にして一覧を上に */}
          {!hasSearched && isDesktop ? (
            <p className="text-muted-foreground/50 text-xs lg:text-sm">
              キーワードや質問を入力して、関連する論文を見つけましょう
            </p>
          ) : null}
        </div>

        {/* 検索ボックス（モバイルでも1行のまま） */}
        <PaperSearch
          onSearch={handleSearch}
          isLoading={isSearchLoading}
          {...(searchInputValue !== undefined && onSearchInputChange !== undefined
            ? { value: searchInputValue, onChange: onSearchInputChange }
            : {})}
        />

        {/* 絞り込み: モバイルは一覧の手前の折りたたみ領域、デスクトップはインラインコンパクト */}
        {/* モバイルで領域を開いている間は、解除で対象が0件になっても開閉ボタンごと消さない */}
        {(showFilterArea || (!isDesktop && isFilterPanelOpen)) &&
          (!isDesktop ? (
            /* モバイル: 一覧の手前に折りたたみ式の絞り込み領域を置く（一覧を覆わず、結果を見ながら調整できる） */
            <div className="space-y-2 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  ref={filterToggleRef}
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFilterPanelOpen((open) => !open)}
                  className="h-8 shrink-0 gap-1.5 px-3 text-sm"
                  aria-expanded={isFilterPanelOpen}
                  aria-controls={filterPanelId}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  絞り込み
                  {activeFilterCount > 0 ? (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-xs font-medium text-primary">
                      <span className="sr-only">（適用中の条件</span>
                      {activeFilterCount}
                      <span className="sr-only">件）</span>
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      isFilterPanelOpen && "rotate-180"
                    )}
                    aria-hidden
                  />
                </Button>
                {activeConditionLabels.length > 0 ? (
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {activeConditionLabels.join("・")}
                  </p>
                ) : (
                  <span className="flex-1" />
                )}
                <p
                  className="shrink-0 text-xs text-muted-foreground"
                  data-testid="filter-result-count"
                >
                  {isSearchLoading ? "" : `${filteredPapers.length}件`}
                </p>
              </div>
              <output
                className="sr-only"
                aria-live="polite"
                aria-atomic="true"
                aria-label="絞り込みの結果"
              >
                {filterAnnouncement}
              </output>
              <section
                id={filterPanelId}
                aria-label="絞り込み条件"
                hidden={!isFilterPanelOpen}
                onKeyDown={(event) => {
                  // Esc で折りたたみ、内部にあったフォーカスを開閉ボタンへ戻す
                  if (event.key === "Escape") {
                    setIsFilterPanelOpen(false);
                    filterToggleRef.current?.focus();
                  }
                }}
                className="space-y-3 rounded-lg border border-border/60 p-3"
              >
                {/* 表示: すべて / いいね / ブックマーク */}
                <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
                  <legend className="mb-2 text-xs font-medium text-muted-foreground">表示</legend>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={filterMode === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        toggleFilterMode("all");
                        markFilterAdjusted();
                      }}
                      aria-pressed={filterMode === "all"}
                      className="h-8"
                    >
                      すべて
                    </Button>
                    <Button
                      variant={filterMode === "liked" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        toggleFilterMode("liked");
                        markFilterAdjusted();
                      }}
                      disabled={likedCount === 0 && filterMode !== "liked"}
                      aria-pressed={filterMode === "liked"}
                      aria-label={`いいね（${likedCount}件）`}
                      className="h-8 gap-1.5"
                    >
                      <Heart className={cn("h-4 w-4", filterMode === "liked" && "fill-current")} />
                      {likedCount}
                    </Button>
                    <Button
                      variant={filterMode === "bookmarked" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        toggleFilterMode("bookmarked");
                        markFilterAdjusted();
                      }}
                      disabled={bookmarkedCount === 0 && filterMode !== "bookmarked"}
                      aria-pressed={filterMode === "bookmarked"}
                      aria-label={`ブックマーク（${bookmarkedCount}件）`}
                      className="h-8 gap-1.5"
                    >
                      <Bookmark
                        className={cn("h-4 w-4", filterMode === "bookmarked" && "fill-current")}
                      />
                      {bookmarkedCount}
                    </Button>
                  </div>
                </fieldset>

                {/* カテゴリ（多い場合は領域内でスクロールし、一覧の先頭を押し出しすぎない） */}
                {availableCategories.length > 1 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">カテゴリ</p>
                    <div className="max-h-28 overflow-y-auto">
                      <CategoryFilter
                        availableCategories={availableCategories}
                        selectedCategories={selectedCategories}
                        onToggle={(category) => {
                          toggleCategory(category);
                          markFilterAdjusted();
                        }}
                        onClear={clearFiltersFromPanel}
                        hideLabel
                      />
                    </div>
                  </div>
                ) : null}

                {/* クリア（フィルターのみ解除。領域は開いたまま） */}
                {activeFilterCount > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFiltersFromPanel}
                    className="w-full justify-center text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    絞り込みをクリア
                  </Button>
                ) : null}
              </section>
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
                        filterMode === "liked" ? "すべての論文を表示" : "いいねした論文のみ表示"
                      }
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
              {availableCategories.length > 1 ? (
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
              ) : null}
            </div>
          ))}

        {isExpandedPaperFilteredOut ? (
          <p className="text-xs text-muted-foreground">
            選択中の論文は絞り込み条件に合わないため、一覧に表示していません
          </p>
        ) : null}
      </section>

      {/* 論文リスト */}
      <PaperList
        papers={filteredPapers}
        isLoading={isSearchLoading}
        isSearchLoading={isSearchLoading}
        // 検索結果そのものが0件のときだけ検索の理由を出す。絞り込みで0件なら一覧の「条件に一致しない」に任せる
        emptyMessage={
          hasSearched &&
          !isSearchLoading &&
          filteredPapers.length === 0 &&
          displayPapers.length === 0
            ? emptySearchMessage
            : undefined
        }
        showCount={hasSearched && !isSearchLoading && filteredPapers.length > 0}
        renderCountAccessory={hasSearched && !isSearchLoading ? renderSearchResultTools : undefined}
        onPaperClick={onPaperClick}
        whyReadMap={whyReadMap}
        // 検索結果表示中、カテゴリフィルタ中、いいね/ブックマークフィルタ中は追加読み込みを無効化
        onRequestSync={
          hasSearched || selectedCategories.size > 0 || filterMode !== "all"
            ? undefined
            : onRequestSync
        }
        // インライン展開
        expandedPaperId={expandedPaperId}
        renderExpandedDetail={renderExpandedDetail}
        onSync={onSync}
        onRetrySync={onRetrySync}
        isSyncPending={isSyncPending}
        onOpenSettings={onOpenSettings}
        onClearConditions={hasSearched || activeFilterCount > 0 ? handleClear : undefined}
      />
    </div>
  );
};
