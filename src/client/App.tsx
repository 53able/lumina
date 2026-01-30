import { Settings, Sparkles } from "lucide-react";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import type { Paper, SearchHistory as SearchHistoryType } from "../shared/schemas/index";
import { PaperDetail } from "./components/PaperDetail";
import { PaperExplorer } from "./components/PaperExplorer";
import { SearchHistory } from "./components/SearchHistory";
import { SettingsDialog } from "./components/SettingsDialog";
import { SyncButton } from "./components/SyncButton";
import { Button } from "./components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePaperSummary } from "./hooks/usePaperSummary";
import { useSemanticSearch } from "./hooks/useSemanticSearch";
import { useSyncPapers } from "./hooks/useSyncPapers";
import { PaperPage } from "./pages/PaperPage";
import { usePaperStore } from "./stores/paperStore";
import { useSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSummaryStore } from "./stores/summaryStore";

/**
 * Lumina アプリケーションのルートコンポーネント
 *
 * ルーティング設定:
 * - / : 論文一覧（HomePage）
 * - /papers/:id : 論文詳細ページ（PaperPage）
 */
export const App: FC = () => {
  return (
    <Routes>
      <Route path="/papers/:id" element={<PaperPage />} />
      <Route path="/*" element={<HomePage />} />
    </Routes>
  );
};

/**
 * HomePage - 論文一覧ページ
 *
 * Design Docsに基づく機能:
 * - ヘッダー（ロゴ・タイトル）
 * - PaperExplorer（検索・論文リスト）
 * - いいね/ブックマーク状態管理
 */
const HomePage: FC = () => {
  const { papers, isLoading: isPapersLoading } = usePaperStore();
  const { selectedCategories, syncPeriodDays, autoGenerateSummary, shouldAutoSync } =
    useSettingsStore();
  const {
    search,
    searchWithSavedData,
    results,
    papersExcludedFromSearch,
    isLoading,
    expandedQuery,
    queryEmbedding,
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

  // サマリー管理（カスタムフックに責務を委譲）
  const {
    summary: currentSummary,
    summaryLanguage,
    setSummaryLanguage,
    isLoading: isSummaryLoading,
    generateSummary,
  } = usePaperSummary({
    paperId: selectedPaper?.id ?? "",
    abstract: selectedPaper?.abstract ?? "",
    onError: (err) => {
      console.error("Summary generation error:", err);
      const message = err instanceof Error ? err.message : "要約の生成に失敗しました";
      toast.error("要約生成エラー", {
        description: message,
      });
    },
  });

  // サマリーストア（whyReadMap生成用、展開中の論文のサマリー取得用）
  const { summaries, getSummaryByPaperIdAndLanguage } = useSummaryStore();

  // whyReadMap を生成（論文ID → whyRead のマップ）
  // summaryLanguage に合わせた言語の whyRead を取得
  const whyReadMap = new Map(
    summaries
      .filter((s) => s.language === summaryLanguage && s.whyRead)
      .map((s) => [s.paperId, s.whyRead as string])
  );

  // 検索履歴（searchHistoryStore経由で永続化）
  const { addHistory, getRecentHistories, deleteHistory } = useSearchHistoryStore();
  const recentHistories = getRecentHistories(10);

  // 最後に検索したクエリを追跡（履歴追加用）
  const lastSearchQueryRef = useRef<string | null>(null);

  // 検索成功時に履歴を追加
  useEffect(() => {
    // expandedQueryとqueryEmbeddingがあり、検索クエリが記録されている場合のみ
    if (expandedQuery && queryEmbedding && lastSearchQueryRef.current) {
      const history = {
        id: crypto.randomUUID(),
        originalQuery: lastSearchQueryRef.current,
        expandedQuery,
        queryEmbedding,
        resultCount: results.length,
        createdAt: new Date(),
      };
      addHistory(history);
      // 追加後にリセット（重複防止）
      lastSearchQueryRef.current = null;
    }
  }, [expandedQuery, queryEmbedding, results.length, addHistory]);

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

  // 論文クリックハンドラー（インライン展開のトグル）
  const handlePaperClick = useCallback((paper: Paper) => {
    // 同じ論文をクリックしたら折りたたむ、違う論文なら展開
    setSelectedPaper((prev) => (prev?.id === paper.id ? null : paper));
  }, []);

  // 詳細パネルを閉じる
  const handleCloseDetail = useCallback(() => {
    setSelectedPaper(null);
  }, []);

  // サマリー生成ハンドラー（PaperDetailのインターフェースに合わせたラッパー）
  const handleGenerateSummary = useCallback(
    async (_paperId: string, language: "ja" | "en", target: "explanation" | "both" = "both") => {
      // usePaperSummaryのgenerateSummaryはlanguageがオプショナルなので、明示的に渡す
      // paperIdはusePaperSummaryの初期化時に設定されているため、ここでは使用しない
      await generateSummary(language, target);
    },
    [generateSummary]
  );

  // サマリー言語切替
  const handleSummaryLanguageChange = useCallback(
    (language: "ja" | "en") => {
      setSummaryLanguage(language);
    },
    [setSummaryLanguage]
  );

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
      // 履歴にqueryEmbeddingが保存されている場合は、保存済みデータを使用（APIリクエストなし）
      if (history.queryEmbedding && history.queryEmbedding.length > 0) {
        // 履歴追加用にクエリを記録（既存履歴が更新される）
        lastSearchQueryRef.current = history.originalQuery;
        searchWithSavedData(history.expandedQuery, history.queryEmbedding);
      } else {
        // queryEmbeddingがない場合は通常の検索を実行（APIリクエストあり）
        lastSearchQueryRef.current = history.originalQuery;
        search(history.originalQuery);
      }
    },
    [search, searchWithSavedData]
  );

  // 検索履歴を削除
  const handleDeleteHistory = useCallback(
    (id: string) => {
      deleteHistory(id);
    },
    [deleteHistory]
  );

  // 検索結果の論文リスト（関連度順）
  const searchResultPapers = results.map((r) => r.paper);

  // 検索中かどうかを判定（expandedQueryがあれば検索後）
  const isSearchActive = expandedQuery !== null;

  // 初期表示用の論文（検索後は検索結果＋検索対象外を常時可視化、それ以外はストアから）
  const displayPapers = isSearchActive
    ? [...searchResultPapers, ...papersExcludedFromSearch]
    : papers;

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background bg-gradient-bold bg-particles">
      {/* Header - 全幅レイアウト、ロゴ中央・ボタン右端 */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-md supports-backdrop-filter:bg-background/60">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-4 gap-4">
          {/* 左側: 空（バランス用） */}
          <div className="flex items-center justify-start">
            {/* モバイルでは何も表示しない、デスクトップでも空 */}
          </div>

          {/* 中央: ロゴ・タイトル - グローエフェクト */}
          <div className="flex items-center gap-3 glow-effect justify-center">
            <div className="relative">
              <Sparkles
                className="h-8 w-8 text-primary animate-glow"
                style={{ filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.6))" }}
              />
              <div className="absolute inset-0 blur-xl bg-primary/30 rounded-full animate-pulse-glow" />
            </div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold">
                <span className="bg-linear-to-r from-primary via-primary/80 to-primary-light bg-clip-text text-transparent">
                  Lumina
                </span>
              </h1>
              <span
                className="text-xs font-mono font-bold uppercase tracking-wider"
                style={{
                  color: "hsl(var(--primary-dark))",
                  opacity: 0.8,
                  letterSpacing: "0.15em",
                }}
              >
                BETA
              </span>
              <span
                className="hidden sm:inline text-sm font-mono text-rotate-slight font-bold"
                style={{ opacity: 0.7 }}
              >
                arXiv論文セマンティック検索
              </span>
            </div>
          </div>

          {/* 右側: 同期・設定ボタン（画面右端） */}
          <div className="flex items-center gap-2 justify-end">
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
      <div className="flex min-h-0 relative">
        {/* Sidebar - 検索履歴 */}
        <aside className="hidden lg:flex w-64 flex-col bg-sidebar/50 relative z-10">
          {/* 視線誘導の基準線 - サイドバーとメインコンテンツの境界 */}
          <div
            className="absolute right-0 top-0 bottom-0 w-[3px] pointer-events-none z-20"
            style={{
              background:
                "linear-gradient(to bottom, transparent, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.6), hsl(var(--primary-light) / 0.8), hsl(var(--primary) / 0.6), hsl(var(--primary) / 0.2), transparent)",
              boxShadow: "0 0 12px hsl(var(--primary) / 0.5), 0 0 24px hsl(var(--primary) / 0.3)",
              filter: "blur(1px)",
            }}
          />
          <div className="px-6 pt-6 pb-4">
            <h3
              className="text-sm font-bold uppercase tracking-wider text-primary-light"
              style={{ opacity: 1 }}
            >
              検索履歴
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <SearchHistory
              histories={recentHistories}
              onReSearch={handleReSearch}
              onDelete={handleDeleteHistory}
              compact
            />
          </div>
        </aside>

        {/* Main Content - 論文リスト */}
        <main className="flex-1 overflow-y-auto min-w-0 relative z-10">
          <div className="px-6 py-8 lg:px-12 lg:py-10">
            {/* 拡張クエリ情報の表示 - ロジック駆動: 関連要素は近くに */}
            {expandedQuery && (
              <div className="mb-4 rounded-xl bg-muted/30 border-2 border-primary/30 p-6 backdrop-blur-sm shadow-lg shadow-primary/10">
                <p className="text-sm" style={{ opacity: 1 }}>
                  <span className="font-bold text-primary-light" style={{ opacity: 1 }}>
                    検索クエリ:
                  </span>{" "}
                  <span style={{ opacity: 0.95 }}>{expandedQuery.original}</span>
                  {expandedQuery.original !== expandedQuery.english && (
                    <span className="ml-2 text-primary font-bold" style={{ opacity: 1 }}>
                      → {expandedQuery.english}
                    </span>
                  )}
                </p>
                {expandedQuery.synonyms.length > 0 && (
                  <p className="text-xs mt-2" style={{ opacity: 0.7 }}>
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
              onPaperClick={handlePaperClick}
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
                  <div className="h-12 w-12 animate-loading-bold rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground font-bold">検索中...</p>
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
