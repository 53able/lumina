import { Settings, Sparkles } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaperDetail } from "@/client/components/PaperDetail";
import { PaperExplorer } from "@/client/components/PaperExplorer";
import { SearchHistory } from "@/client/components/SearchHistory";
import { SettingsDialog } from "@/client/components/SettingsDialog";
import { SyncButton } from "@/client/components/SyncButton";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/client/components/ui/tooltip";
import { useMediaQuery } from "@/client/hooks/useMediaQuery";
import { useSemanticSearch } from "@/client/hooks/useSemanticSearch";
import { useSyncPapers } from "@/client/hooks/useSyncPapers";
import { summaryApi } from "@/client/lib/api";
import { useInteractionStore } from "@/client/stores/interactionStore";
import { usePaperStore } from "@/client/stores/paperStore";
import { useSearchHistoryStore } from "@/client/stores/searchHistoryStore";
import { useSettingsStore } from "@/client/stores/settingsStore";
import { useSummaryStore } from "@/client/stores/summaryStore";
import type { Paper, PaperSummary, SearchHistory as SearchHistoryType } from "@/shared/schemas";

/**
 * Lumina アプリケーションのルートコンポーネント
 *
 * Design Docsに基づく機能:
 * - ヘッダー（ロゴ・タイトル）
 * - PaperExplorer（検索・論文リスト）
 * - いいね/ブックマーク状態管理
 */
export const App: FC = () => {
  const { papers, isLoading: isPapersLoading } = usePaperStore();
  const { apiKey, selectedCategories, syncPeriodDays, autoGenerateSummary, shouldAutoSync } =
    useSettingsStore();
  const {
    search,
    results,
    isLoading,
    expandedQuery,
    reset: clearSearch,
  } = useSemanticSearch({
    papers,
  });

  // 設定ダイアログの開閉状態
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 画面サイズ判定（lg = 1024px以上）
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 論文詳細の状態（デスクトップ: 詳細パネル、モバイル: Sheet）
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [summaryLanguage, setSummaryLanguage] = useState<"ja" | "en">("ja");
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);

  // サマリーストア
  const { getSummaryByPaperIdAndLanguage, addSummary, summaries } = useSummaryStore();

  // whyReadMap を生成（論文ID → whyRead のマップ）
  // summaryLanguage に合わせた言語の whyRead を取得
  const whyReadMap = new Map(
    summaries
      .filter((s) => s.language === summaryLanguage && s.whyRead)
      .map((s) => [s.paperId, s.whyRead as string])
  );

  // いいね/ブックマーク状態（interactionStore経由で永続化）
  const { toggleLike, toggleBookmark, getLikedPaperIds, getBookmarkedPaperIds } =
    useInteractionStore();
  const likedPaperIds = getLikedPaperIds();
  const bookmarkedPaperIds = getBookmarkedPaperIds();

  // 検索履歴（searchHistoryStore経由で永続化）
  const { addHistory, getRecentHistories, deleteHistory } = useSearchHistoryStore();
  const recentHistories = getRecentHistories(10);

  // 最後に検索したクエリを追跡（履歴追加用）
  const lastSearchQueryRef = useRef<string | null>(null);

  // 検索成功時に履歴を追加
  useEffect(() => {
    // expandedQueryがあり、検索クエリが記録されている場合のみ
    if (expandedQuery && lastSearchQueryRef.current) {
      const history = {
        id: crypto.randomUUID(),
        originalQuery: lastSearchQueryRef.current,
        expandedQuery,
        resultCount: results.length,
        createdAt: new Date(),
      };
      addHistory(history);
      // 追加後にリセット（重複防止）
      lastSearchQueryRef.current = null;
    }
  }, [expandedQuery, results.length, addHistory]);

  // 検索ハンドラー
  const handleSearch = useCallback(
    async (query: string): Promise<Paper[]> => {
      // 履歴追加用にクエリを記録
      lastSearchQueryRef.current = query;
      // search()が結果を直接返すので、それを使用
      const searchResults = await search(query);
      // 検索結果からPaperのみを返す
      return searchResults.map((r) => r.paper);
    },
    [search]
  );

  // いいねハンドラー（interactionStore経由で永続化）
  const handleLike = useCallback(
    (paperId: string) => {
      toggleLike(paperId);
    },
    [toggleLike]
  );

  // ブックマークハンドラー（interactionStore経由で永続化）
  const handleBookmark = useCallback(
    (paperId: string) => {
      toggleBookmark(paperId);
    },
    [toggleBookmark]
  );

  // 論文クリックハンドラー（インライン展開のトグル）
  const handlePaperClick = useCallback((paper: Paper) => {
    // 同じ論文をクリックしたら折りたたむ、違う論文なら展開
    setSelectedPaper((prev) => (prev?.id === paper.id ? null : paper));
  }, []);

  // 詳細パネルを閉じる
  const handleCloseDetail = useCallback(() => {
    setSelectedPaper(null);
  }, []);

  // 現在選択中の論文のサマリー
  const currentSummary: PaperSummary | undefined = selectedPaper
    ? getSummaryByPaperIdAndLanguage(selectedPaper.id, summaryLanguage)
    : undefined;

  // サマリー生成ハンドラー
  // target: "summary" = 要約のみ, "explanation" = 説明文のみ, "both" = 両方
  const handleGenerateSummary = useCallback(
    async (
      paperId: string,
      language: "ja" | "en",
      target: "summary" | "explanation" | "both" = "summary"
    ) => {
      if (!selectedPaper) return;

      setIsSummaryLoading(true);
      try {
        const newData = await summaryApi(
          paperId,
          { language, abstract: selectedPaper.abstract, generateTarget: target },
          { apiKey: apiKey ?? undefined }
        );

        // 説明文のみ生成の場合、既存の要約を維持してマージ
        const existingSummary = getSummaryByPaperIdAndLanguage(paperId, language);
        const mergedSummary: PaperSummary =
          target === "explanation" && existingSummary
            ? {
                ...existingSummary,
                explanation: newData.explanation,
                targetAudience: newData.targetAudience,
                whyRead: newData.whyRead,
              }
            : newData;

        await addSummary(mergedSummary);
      } catch (error) {
        console.error("Summary generation error:", error);
        const message = error instanceof Error ? error.message : "要約の生成に失敗しました";
        toast.error("要約生成エラー", {
          description: message,
        });
      } finally {
        setIsSummaryLoading(false);
      }
    },
    [selectedPaper, apiKey, addSummary, getSummaryByPaperIdAndLanguage]
  );

  // サマリー言語切替
  const handleSummaryLanguageChange = useCallback((language: "ja" | "en") => {
    setSummaryLanguage(language);
  }, []);

  // 同期処理（React Query useQuery + 5分キャッシュ）
  const {
    sync: syncPapers,
    syncMore,
    isSyncing,
    hasMore: hasMorePapers,
  } = useSyncPapers(
    {
      categories: selectedCategories,
      period: syncPeriodDays,
      apiKey: apiKey ?? undefined,
    },
    {
      onSuccess: (data) => {
        if (data.papers.length > 0) {
          toast.success("同期完了", {
            description: `${data.papers.length}件の論文を取得しました`,
          });
        }
      },
      onError: (error) => {
        console.error("Sync error:", error);
        const message = error instanceof Error ? error.message : "論文の同期に失敗しました";
        toast.error("同期エラー", {
          description: message,
        });
      },
    }
  );

  // 初回自動同期フラグ（一度だけ実行するため）
  const hasAutoSyncedRef = useRef(false);

  // 自動同期条件を判定
  // - キャッシュ0件の場合
  // - 最終同期から24時間以上経過している場合
  useEffect(() => {
    // 条件: ローディング完了 & 同期中でない & まだ自動同期していない
    if (isPapersLoading || isSyncing || hasAutoSyncedRef.current) return;

    const needsSync = papers.length === 0 || shouldAutoSync();
    if (needsSync) {
      hasAutoSyncedRef.current = true;
      console.log(
        "[App] Auto-sync triggered:",
        papers.length === 0 ? "no cached papers" : "last sync > 24h ago"
      );
      syncPapers();
    }
  }, [papers.length, isPapersLoading, isSyncing, shouldAutoSync, syncPapers]);

  // 検索をクリア（初期状態に戻す）
  const handleClearSearch = useCallback(() => {
    clearSearch();
  }, [clearSearch]);

  // 検索履歴から再検索
  const handleReSearch = useCallback(
    (history: SearchHistoryType) => {
      // 履歴追加用にクエリを記録（既存履歴が更新される）
      lastSearchQueryRef.current = history.originalQuery;
      search(history.originalQuery);
    },
    [search]
  );

  // 検索履歴を削除
  const handleDeleteHistory = useCallback(
    (id: string) => {
      deleteHistory(id);
    },
    [deleteHistory]
  );

  // 検索結果の論文リスト
  const searchResultPapers = results.map((r) => r.paper);

  // 検索中かどうかを判定（expandedQueryがあれば検索後）
  const isSearchActive = expandedQuery !== null;

  // 初期表示用の論文（検索後は検索結果（0件含む）、それ以外はストアから）
  const displayPapers = isSearchActive ? searchResultPapers : papers;

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background bg-gradient-lumina">
      {/* Header - 全幅レイアウト、ロゴ中央・ボタン右端 */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md supports-backdrop-filter:bg-background/60">
        <div className="relative flex items-center justify-between px-6 py-4">
          {/* 左スペーサー（ボタン群と同じ幅を確保してロゴを中央に） */}
          <div className="w-24 sm:w-32" />

          {/* 中央: ロゴ・タイトル（絶対配置で完全中央） */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
            <div className="relative">
              <Sparkles className="h-8 w-8 text-primary animate-glow" />
              <div className="absolute inset-0 blur-xl bg-primary/30 rounded-full" />
            </div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="bg-linear-to-r from-primary via-primary/80 to-accent bg-clip-text text-transparent">
                  Lumina
                </span>
              </h1>
              <span className="hidden sm:inline text-sm text-muted-foreground/80">
                arXiv論文セマンティック検索
              </span>
            </div>
          </div>

          {/* 右側: 同期・設定ボタン（画面右端） */}
          <div className="flex items-center gap-2">
            <SyncButton isSyncing={isSyncing} onSync={syncPapers} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSettingsOpen(true)}
                  aria-label="設定"
                  className="hover:bg-muted/50"
                >
                  <Settings className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>設定</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* 設定ダイアログ */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />

      {/* Mobile: 論文詳細 Sheet (lg未満で表示) */}
      <Sheet
        open={!isDesktop && !!selectedPaper}
        onOpenChange={(open) => !open && handleCloseDetail()}
      >
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>論文詳細</SheetTitle>
            <SheetDescription>選択した論文の詳細情報</SheetDescription>
          </SheetHeader>
          {selectedPaper && (
            <PaperDetail
              paper={selectedPaper}
              onLike={handleLike}
              onBookmark={handleBookmark}
              isLiked={likedPaperIds.has(selectedPaper.id)}
              isBookmarked={bookmarkedPaperIds.has(selectedPaper.id)}
              summary={currentSummary}
              onGenerateSummary={handleGenerateSummary}
              isSummaryLoading={isSummaryLoading}
              selectedSummaryLanguage={summaryLanguage}
              onSummaryLanguageChange={handleSummaryLanguageChange}
              autoGenerateSummary={autoGenerateSummary}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Main Layout: Sidebar + List + Detail (Master-Detail Pattern) */}
      <div className="flex min-h-0">
        {/* Sidebar - 検索履歴 */}
        <aside className="hidden lg:flex w-56 flex-col border-r border-border/40 bg-sidebar/50">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              検索履歴
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            <SearchHistory
              histories={recentHistories}
              onReSearch={handleReSearch}
              onDelete={handleDeleteHistory}
              compact
            />
          </div>
        </aside>

        {/* Main Content - 論文リスト */}
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="px-3 py-4 lg:px-4 lg:py-5">
            {/* 拡張クエリ情報の表示 */}
            {expandedQuery && (
              <div className="mb-8 rounded-xl bg-muted/30 border border-border/30 p-4 backdrop-blur-sm">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground/80">検索クエリ:</span>{" "}
                  {expandedQuery.original}
                  {expandedQuery.original !== expandedQuery.english && (
                    <span className="ml-2 text-primary font-medium">→ {expandedQuery.english}</span>
                  )}
                </p>
                {expandedQuery.synonyms.length > 0 && (
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    関連語: {expandedQuery.synonyms.join(", ")}
                  </p>
                )}
              </div>
            )}

            {/* Paper Explorer */}
            <PaperExplorer
              initialPapers={displayPapers}
              onSearch={handleSearch}
              onClear={handleClearSearch}
              onLike={handleLike}
              onBookmark={handleBookmark}
              onPaperClick={handlePaperClick}
              likedPaperIds={likedPaperIds}
              bookmarkedPaperIds={bookmarkedPaperIds}
              externalQuery={expandedQuery?.original ?? null}
              whyReadMap={whyReadMap}
              onRequestSync={hasMorePapers ? syncMore : undefined}
              isSyncing={isSyncing}
              // インライン展開（デスクトップのみ）
              expandedPaperId={isDesktop ? (selectedPaper?.id ?? null) : null}
              renderExpandedDetail={
                isDesktop
                  ? (paper) => (
                      <PaperDetail
                        paper={paper}
                        onLike={handleLike}
                        onBookmark={handleBookmark}
                        isLiked={likedPaperIds.has(paper.id)}
                        isBookmarked={bookmarkedPaperIds.has(paper.id)}
                        summary={getSummaryByPaperIdAndLanguage(paper.id, summaryLanguage)}
                        onGenerateSummary={handleGenerateSummary}
                        isSummaryLoading={isSummaryLoading}
                        selectedSummaryLanguage={summaryLanguage}
                        onSummaryLanguageChange={handleSummaryLanguageChange}
                        autoGenerateSummary={autoGenerateSummary}
                      />
                    )
                  : undefined
              }
            />

            {/* ローディング中の検索結果表示 */}
            {isLoading && results.length === 0 && (
              <div className="mt-12 grid place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground">検索中...</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Footer - 固定表示 */}
      <footer className="sticky bottom-0 z-40 border-t border-border/30 py-5 text-center text-xs text-muted-foreground/40 bg-background/80 backdrop-blur-md">
        <p>Built with 💜 for researchers</p>
        <p className="mt-1.5">
          Thank you to{" "}
          <a
            href="https://arxiv.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/20 underline-offset-2 hover:text-foreground/60 hover:decoration-foreground/40 transition-colors"
          >
            arXiv
          </a>{" "}
          for use of its open access interoperability.
        </p>
      </footer>
    </div>
  );
};
