import { type FC, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import type { Paper, PaperSummary } from "../shared/schemas/index";
import { HomeFooter } from "./components/HomeFooter";
import { HomeHeader } from "./components/HomeHeader";
import { HomeMain } from "./components/HomeMain";
import { useHomeSearch } from "./hooks/useHomeSearch";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePaperSummary } from "./hooks/usePaperSummary";
import { useSyncPapers } from "./hooks/useSyncPapers";
import { SyncRateLimitError } from "./lib/api";
import { getEmptySearchMessage } from "./lib/emptySearchMessage";
import { showSummaryErrorToast } from "./lib/summaryErrors";
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
const StatsPage = lazy(() => import("./pages/StatsPage").then((m) => ({ default: m.StatsPage })));

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
 * - /stats : 論文キャッシュの時系列（StatsPage）
 */
export const App: FC = () => {
  useEffect(() => {
    const runMigrationMaybeNotify = () => {
      const didRun = useSettingsStore.getState().runSyncPeriodResetMigration();
      if (didRun) {
        toast.info("同期期間を3日に統一しました。必要に応じて設定で変更できます。");
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
        <Route
          path="/stats"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StatsPage />
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
    autoGenerateSummary: autoGenerateSummarySetting,
    apiEnabled,
    shouldAutoSync,
    searchScoreThreshold,
  } = useSettingsStore();
  // API利用OFF中は自動要約を発火させない（設定値は保持し、ONに戻すと再開する）
  const autoGenerateSummary = autoGenerateSummarySetting && apiEnabled;
  // 検索履歴（searchHistoryStore経由で永続化）
  const { histories, addHistory, getRecentHistories, deleteHistory } = useSearchHistoryStore();
  const recentHistories = getRecentHistories(10);
  const findSavedHistory = useCallback(
    (query: string) => histories.find((h) => h.originalQuery === query),
    [histories]
  );

  // 検索（入力・URL・履歴の各入口を1つの実行経路にまとめる）
  const {
    results,
    papersExcludedFromSearch,
    isLoading,
    expandedQuery,
    queryEmbedding,
    error: searchError,
    completedQuery,
    stoppedQuery,
    searchInputValue,
    setSearchInputValue,
    handleSearch,
    handleClearSearch,
    handleReSearch,
    handleSearchWithEditedText,
  } = useHomeSearch({
    papers,
    scoreThreshold: searchScoreThreshold,
    addHistory,
    findSavedHistory,
  });

  // API利用OFFで止まった検索は、保存済み論文の一覧を残したまま停止理由を通知する
  useEffect(() => {
    if (stoppedQuery !== null && searchError) {
      toast.error("検索停止中: 保存済みの論文を表示しています", {
        id: "api-disabled-search",
        description: searchError.message,
      });
    }
  }, [stoppedQuery, searchError]);

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
    error: summaryError,
    failedTarget: summaryFailedTarget,
    generateSummary,
  } = usePaperSummary({
    paperId: selectedPaper?.id ?? "",
    abstract: selectedPaper?.abstract ?? "",
    onError: (err, paperId, target) => {
      console.error("Summary generation error:", err);
      // 生成中に別の論文へ切り替えている場合があるため、どの論文の失敗かを示す
      showSummaryErrorToast(err, papers.find((p) => p.id === paperId)?.title, target);
    },
  });

  // サマリーストア（whyReadMap生成用、展開中の論文のサマリー取得用）
  const { summaries, getSummaryByPaperIdAndLanguage } = useSummaryStore();

  // whyReadMap を生成（論文ID → whyRead のマップ）
  // summaryLanguage に合わせた言語の whyRead を取得
  // React Best Practice: useMemoでメモ化して不要な再計算を防ぐ
  // 同じ論文に複数の版がある場合は最新の版（最後に追加されたもの）の whyRead を使う
  const whyReadMap = useMemo(() => {
    const latestByPaperId = new Map<string, PaperSummary>();
    for (const s of summaries) {
      if (s.language === summaryLanguage) latestByPaperId.set(s.paperId, s);
    }
    const map = new Map<string, string>();
    for (const [paperId, s] of latestByPaperId) {
      if (s.whyRead) map.set(paperId, s.whyRead);
    }
    return map;
  }, [summaries, summaryLanguage]);

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
      // 表示中の言語を明示的に渡す。paperId は usePaperSummary に渡した選択中の論文を使うため、ここでは使用しない
      // 同じ論文・言語の生成が実行中なら generateSummary は何もせずに返る
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
    retrySync,
    syncMore,
    syncAll,
    stopSync,
    runEmbeddingBackfill,
    isSyncing,
    isSyncingFromDate,
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
    if (isSyncingFromDate) {
      toast.info("取得を停止しています");
      return;
    }
    toast.success("同期を停止しました");
  }, [isSyncingFromDate, stopSync]);

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

  // 論文0件で自動同期を始める直前（effect 実行前の描画）に「論文がありません」を出さない
  const isAutoSyncPending = !hasAutoSyncedRef.current && !isPapersLoading && papers.length === 0;

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
        // OFFで止まった検索は、確定クエリ（URL の q）に対して親の一覧（保存済み論文）を表示させる
        externalQuery={stoppedQuery ?? completedQuery}
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
                    summaryError={summaryError}
                    summaryFailedTarget={summaryFailedTarget}
                    selectedSummaryLanguage={summaryLanguage}
                    onSummaryLanguageChange={handleSummaryLanguageChange}
                    autoGenerateSummary={autoGenerateSummary}
                  />
                </Suspense>
              )
            : undefined
        }
        expandedQuery={expandedQuery}
        onSearchWithEditedText={handleSearchWithEditedText}
        results={results}
        isLoading={isLoading}
        selectedPaper={selectedPaper}
        onCloseDetail={handleCloseDetail}
        currentSummary={currentSummary}
        onGenerateSummary={handleGenerateSummary}
        isSummaryLoading={isSummaryLoading}
        summaryError={summaryError}
        summaryFailedTarget={summaryFailedTarget}
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
        onSync={syncPapers}
        onRetrySync={retrySync}
        isSyncPending={isAutoSyncPending}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Footer */}
      <HomeFooter />
    </div>
  );
};
