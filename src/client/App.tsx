import {
  type FC,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Paper, SearchHistory as SearchHistoryType } from "../shared/schemas/index";
import { HomeFooter } from "./components/HomeFooter";
import { HomeHeader } from "./components/HomeHeader";
import { HomeMain } from "./components/HomeMain";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePaperSummary } from "./hooks/usePaperSummary";
import { useSearchFromUrl } from "./hooks/useSearchFromUrl";
import { useSearchHistorySync } from "./hooks/useSearchHistorySync";
import { useSemanticSearch } from "./hooks/useSemanticSearch";
import { useSyncPapers } from "./hooks/useSyncPapers";
import { SyncRateLimitError } from "./lib/api";
import { getEmptySearchMessage } from "./lib/emptySearchMessage";
import { usePaperStore } from "./stores/paperStore";
import { useSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSummaryStore } from "./stores/summaryStore";

// 動的インポート（バンドルサイズ最適化）
const PaperDetail = lazy(() =>
  import("./components/PaperDetail").then((m) => ({ default: m.PaperDetail }))
);
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((m) => ({ default: m.SettingsDialog }))
);
const PaperPage = lazy(() => import("./pages/PaperPage").then((m) => ({ default: m.PaperPage })));

/**
 * ローディングフォールバックコンポーネント
 */
const LoadingFallback: FC = () => (
  <div className="grid min-h-dvh place-items-center">
    <div className="flex flex-col items-center gap-3">
      <div className="h-12 w-12 animate-loading-bold rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground font-bold">読み込み中...</p>
    </div>
  </div>
);

/**
 * Lumina アプリケーションのルートコンポーネント
 *
 * ルーティング設定:
 * - / : 論文一覧（HomePage）
 * - /papers/:id : 論文詳細ページ（PaperPage）
 */
export const App: FC = () => {
  useEffect(() => {
    const runMigrationMaybeNotify = () => {
      const didRun = useSettingsStore.getState().runSyncPeriodResetMigration();
      if (didRun) {
        toast.info("同期期間を1日に統一しました。必要に応じて設定で変更できます。");
      }
    };

    const unsub = useSettingsStore.persist.onFinishHydration(runMigrationMaybeNotify);

    if (useSettingsStore.persist.hasHydrated?.()) {
      runMigrationMaybeNotify();
    }

    return () => unsub();
  }, []);

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route
          path="/papers/:id"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <PaperPage />
            </Suspense>
          }
        />
        <Route path="/*" element={<HomePage />} />
      </Routes>
    </Suspense>
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
  const {
    selectedCategories,
    syncPeriodDays,
    autoGenerateSummary,
    shouldAutoSync,
    searchScoreThreshold,
  } = useSettingsStore();
  const {
    search,
    searchWithSavedData,
    results,
    papersExcludedFromSearch,
    isLoading,
    expandedQuery,
    queryEmbedding,
    error: searchError,
    reset: clearSearch,
    totalMatchCount,
  } = useSemanticSearch({
    papers,
    scoreThreshold: searchScoreThreshold,
  });

  // 設定ダイアログの開閉状態
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 検索入力欄の値（履歴クリックで反映・クリアで空にする）
  const [searchInputValue, setSearchInputValue] = useState("");

  // URL の q を読み取り（Phase 2: ロード時の自動検索用。依存はプリミティブ値で無限ループ防止）
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

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
  // React Best Practice: useMemoでメモ化して不要な再計算を防ぐ
  const whyReadMap = useMemo(
    () =>
      new Map(
        summaries
          .filter((s) => s.language === summaryLanguage && s.whyRead)
          .map((s) => [s.paperId, s.whyRead as string])
      ),
    [summaries, summaryLanguage]
  );

  // 検索履歴（searchHistoryStore経由で永続化）
  const { addHistory, getRecentHistories, deleteHistory } = useSearchHistoryStore();
  const recentHistories = getRecentHistories(10);

  // 最後に検索したクエリを追跡（履歴追加用）
  const lastSearchQueryRef = useRef<string | null>(null);

  useSearchHistorySync(
    expandedQuery,
    queryEmbedding,
    totalMatchCount,
    lastSearchQueryRef,
    addHistory
  );

  useSearchFromUrl(urlQuery, search, setSearchInputValue, lastSearchQueryRef);

  // useTransitionで検索を非緊急更新として扱う
  const [_isPending, startTransition] = useTransition();

  // 検索ハンドラー（useTransitionでラップ）
  const handleSearch = useCallback(
    async (query: string): Promise<Paper[]> => {
      // 履歴追加用にクエリを記録
      lastSearchQueryRef.current = query;
      // 検索を実行（結果の更新はトランジションとして扱われる）
      const searchResults = await search(query);
      // 検索結果の更新をトランジションとして扱う
      startTransition(() => {
        // 状態更新は既にsearch()内で行われているため、ここでは何もしない
        // startTransitionは検索結果の表示更新を非緊急として扱う
      });
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
    syncAll,
    stopSync,
    runEmbeddingBackfill,
    isSyncing,
    hasMore: hasMorePapers,
  } = useSyncPapers(
    {
      categories: selectedCategories,
      period: syncPeriodDays,
    },
    {
      onSuccess: (_data, context) => {
        if (context?.addedCount != null && context.addedCount > 0) {
          toast.success("同期完了", {
            description: `${context.addedCount}件の論文をキャッシュしました`,
          });
        }
      },
      onSyncAllComplete: (totalAddedCount, context) => {
        if (totalAddedCount <= 0) return;
        if (context?.wasAborted) {
          toast.success("取得を停止しました", {
            description: `この間 ${totalAddedCount}件の論文をキャッシュしました`,
          });
        } else {
          toast.success("同期完了", {
            description: `${totalAddedCount}件の論文をキャッシュしました`,
          });
        }
      },
      onError: (error) => {
        console.error("Sync error:", error);
        if (error instanceof SyncRateLimitError) {
          toast.error("レート制限（429）", {
            description: error.message,
          });
        } else {
          const message = error instanceof Error ? error.message : "論文の同期に失敗しました";
          toast.error("同期エラー", {
            description: message,
          });
        }
      },
      onRateLimited: () => {
        toast.info("レート制限（429）のため再試行しています");
      },
    }
  );

  /** 同期停止時に即座にフィードバックを返す（UX: 操作結果を明確に伝える） */
  const handleStopSync = useCallback(() => {
    stopSync();
    toast.success("同期を停止しました");
  }, [stopSync]);

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
      syncPapers();
    }
  }, [papers.length, isPapersLoading, isSyncing, shouldAutoSync, syncPapers]);

  // 検索をクリア（初期状態に戻す）
  const handleClearSearch = useCallback(() => {
    setSearchInputValue("");
    clearSearch();
  }, [clearSearch]);

  // 検索履歴から再検索
  const handleReSearch = useCallback(
    (history: SearchHistoryType) => {
      setSearchInputValue(history.originalQuery);
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

  // 検索結果の論文リスト（関連度順）。results.paper は useSemanticSearch 内で papers から解決されるためストア由来
  const searchResultPapers = results.map((r) => r.paper);

  const isSearchActive = expandedQuery !== null;
  const emptySearchMessage = getEmptySearchMessage(
    isSearchActive,
    results.length,
    searchError,
    queryEmbedding,
    isLoading
  );

  // 初期表示用の論文（検索後は検索結果＋検索対象外を常時可視化、それ以外はストアから）
  // React Best Practice: useMemoでメモ化して不要な再計算を防ぐ
  const displayPapers = useMemo(
    () => (isSearchActive ? [...searchResultPapers, ...papersExcludedFromSearch] : papers),
    [isSearchActive, searchResultPapers, papersExcludedFromSearch, papers]
  );

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background bg-gradient-bold bg-particles">
      {/* Header */}
      <HomeHeader
        onOpenSettings={() => setIsSettingsOpen(true)}
        isSyncing={isSyncing}
        onSync={syncPapers}
      />

      {/* 設定ダイアログ */}
      <Suspense fallback={null}>
        <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      </Suspense>

      {/* Main Content */}
      <HomeMain
        isDesktop={isDesktop}
        displayPapers={displayPapers}
        onSearch={handleSearch}
        onClearSearch={handleClearSearch}
        onPaperClick={handlePaperClick}
        externalQuery={expandedQuery?.original ?? null}
        searchInputValue={searchInputValue}
        onSearchInputChange={setSearchInputValue}
        whyReadMap={whyReadMap}
        onRequestSync={hasMorePapers ? syncMore : undefined}
        emptySearchMessage={emptySearchMessage}
        isSearchLoading={isLoading}
        expandedPaperId={isDesktop ? (selectedPaper?.id ?? null) : null}
        renderExpandedDetail={
          isDesktop
            ? (paper) => (
                <Suspense fallback={<div className="p-6">読み込み中...</div>}>
                  <PaperDetail
                    paper={paper}
                    summary={getSummaryByPaperIdAndLanguage(paper.id, summaryLanguage)}
                    onGenerateSummary={handleGenerateSummary}
                    isSummaryLoading={isSummaryLoading}
                    selectedSummaryLanguage={summaryLanguage}
                    onSummaryLanguageChange={handleSummaryLanguageChange}
                    autoGenerateSummary={autoGenerateSummary}
                  />
                </Suspense>
              )
            : undefined
        }
        expandedQuery={expandedQuery}
        results={results}
        isLoading={isLoading}
        selectedPaper={selectedPaper}
        onCloseDetail={handleCloseDetail}
        currentSummary={currentSummary}
        onGenerateSummary={handleGenerateSummary}
        isSummaryLoading={isSummaryLoading}
        summaryLanguage={summaryLanguage}
        onSummaryLanguageChange={handleSummaryLanguageChange}
        autoGenerateSummary={autoGenerateSummary}
        recentHistories={recentHistories}
        onReSearch={handleReSearch}
        onDeleteHistory={handleDeleteHistory}
        hasMore={hasMorePapers}
        onSyncAll={syncAll}
        onRunEmbeddingBackfill={runEmbeddingBackfill}
        onStopSync={handleStopSync}
      />

      {/* Footer */}
      <HomeFooter />
    </div>
  );
};
