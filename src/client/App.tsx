import { type FC, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import type { Paper } from "../shared/schemas/index";
import { HomeFooter } from "./components/HomeFooter";
import { HomeHeader } from "./components/HomeHeader";
import { HomeMain } from "./components/HomeMain";
import { SearchStatusPanel } from "./components/SearchStatusPanel";
import { SkipLinks } from "./components/SkipLinks";
import { useHomeSearch } from "./hooks/useHomeSearch";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePaperSummary } from "./hooks/usePaperSummary";
import { useSearchHistoryUndo } from "./hooks/useSearchHistoryUndo";
import { useSyncPapers } from "./hooks/useSyncPapers";
import { SyncRateLimitError } from "./lib/api";
import { getEmptySearchMessage } from "./lib/emptySearchMessage";
import { showSummaryErrorToast } from "./lib/summaryErrors";
import { usePaperStore } from "./stores/paperStore";
import { useSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { getAdoptedSummaries, useSummaryStore } from "./stores/summaryStore";

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
 * - /papers/:id/* : 論文詳細ページ（PaperPage）。旧形式の ID（math.GT/0309136）はスラッシュを含むため後続のセグメントも受ける
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
          path="/papers/:id/*"
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
  const papers = usePaperStore((s) => s.papers);
  // 保存済み論文の読み込み状態（全件の準備完了まで自動同期・追加同期をしない）
  const paperLoadStatus = usePaperStore((s) => s.loadStatus);
  const arePapersReady = paperLoadStatus === "ready";
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
  // 検索履歴（searchHistoryStore経由で永続化）。すべて渡し、表示件数は SearchHistory の「さらに表示」で増やす（自動削除はしない）
  const { histories, addHistory } = useSearchHistoryStore();
  // 個別削除と取り消し（削除の実行と結果の表示を同じ出どころから渡す）
  const historyUndo = useSearchHistoryUndo();
  const findSavedHistory = useCallback(
    (query: string) => histories.find((h) => h.originalQuery === query),
    [histories]
  );

  // 検索（入力・URL・履歴の各入口を1つの実行経路にまとめる）
  const {
    results,
    papersExcludedFromSearch,
    totalMatchCount,
    isLoading,
    isWaitingForPapers,
    resultsReady,
    resultsScoreThreshold,
    expandedQuery,
    queryEmbedding,
    error: searchError,
    recomputeError,
    resultQuery,
    completedQuery,
    stoppedQuery,
    searchInputValue,
    setSearchInputValue,
    handleSearch,
    handleClearSearch,
    handleReSearch,
    handleSearchWithEditedText,
    displayExpandedQuery,
    previousResultsQuery,
    pendingQuery,
    handleCancelSearch,
    handleRetrySearch,
  } = useHomeSearch({
    papers,
    scoreThreshold: searchScoreThreshold,
    addHistory,
    findSavedHistory,
  });

  // API利用OFFで止まった検索は、保存済み論文の一覧を残したまま停止理由を通知する
  // （前回の結果を表示している場合は保存済み論文の一覧ではないため通知しない。停止理由は検索欄の近くに残る）
  useEffect(() => {
    if (stoppedQuery !== null && searchError && previousResultsQuery === null) {
      toast.error("検索停止中: 保存済みの論文を表示しています", {
        id: "api-disabled-search",
        description: searchError.message,
      });
    }
  }, [stoppedQuery, searchError, previousResultsQuery]);

  // 設定ダイアログの開閉状態
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 画面サイズ判定（lg = 1024px以上）
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 論文詳細の状態（デスクトップ: 詳細パネル、モバイル: Sheet）
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);

  // サマリー管理（カスタムフックに責務を委譲）
  const {
    summary: currentSummary,
    versions: summaryVersions,
    adoptVersion: adoptSummaryVersion,
    discardVersion: discardSummaryVersion,
    saveCorrection: saveSummaryCorrection,
    summaryLanguage,
    setSummaryLanguage,
    isLoading: isSummaryLoading,
    error: summaryError,
    failedTarget: summaryFailedTarget,
    generatingTarget: summaryGeneratingTarget,
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
  const { summaries } = useSummaryStore();

  // 論文ID → 採用版のマップ（summaryLanguage の版から1回だけ作り、一覧と展開中の詳細で引く）
  // 同じ論文に複数の版がある場合は採用版を使う
  const adoptedSummaries = useMemo(
    () => getAdoptedSummaries(summaries, summaryLanguage),
    [summaries, summaryLanguage]
  );

  // whyReadMap を生成（論文ID → whyRead のマップ）
  // 利用者の訂正文は要約本文への訂正のため反映しない（一覧の「読むと得られること（AI）」はAI生成文のまま）
  // React Best Practice: useMemoでメモ化して不要な再計算を防ぐ
  const whyReadMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [paperId, s] of adoptedSummaries) {
      if (s.whyRead) map.set(paperId, s.whyRead);
    }
    return map;
  }, [adoptedSummaries]);

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
    // 条件: 保存済み論文の全件準備完了 & 同期中でない & まだ自動同期していない
    // 読み込み中・読み込み失敗では同期しない（既存論文を新規とみなして重複取得・上書きしないため）
    if (!arePapersReady || isSyncing || hasAutoSyncedRef.current) return;

    const needsSync = papers.length === 0 || shouldAutoSync();
    if (needsSync) {
      hasAutoSyncedRef.current = true;
      syncPapers();
    }
  }, [papers.length, arePapersReady, isSyncing, shouldAutoSync, syncPapers]);

  // 論文0件で自動同期を始める直前（effect 実行前の描画）に「論文がありません」を出さない
  const isAutoSyncPending = !hasAutoSyncedRef.current && arePapersReady && papers.length === 0;

  // 検索結果の論文リスト（関連度順）。results.paper は useSemanticSearch 内で papers から解決されるためストア由来
  const searchResultPapers = results.map((r) => r.paper);

  const isSearchActive = expandedQuery !== null;
  const emptySearchMessage = getEmptySearchMessage(
    isSearchActive,
    results.length,
    // 前回の結果を表示している間の失敗は新しい検索のもの。理由は検索欄の近くに出し、前回の結果の0件理由に混ぜない
    previousResultsQuery === null ? searchError : null,
    queryEmbedding,
    // 前回の結果を表示している間は、その結果の0件理由を出す
    isLoading && previousResultsQuery === null,
    {
      // 案内文は表示中の結果を計算したしきい値で出す（変更直後の再計算中に新しい値を付けない）
      scoreThreshold: resultsScoreThreshold ?? searchScoreThreshold,
      hasSearchablePapers: papers.length > papersExcludedFromSearch.length,
    },
    // 前回の結果は確定済みの結果
    resultsReady || previousResultsQuery !== null
  );

  // 初期表示用の論文（検索後は検索結果＋検索対象外を常時可視化、それ以外はストアから）
  // React Best Practice: useMemoでメモ化して不要な再計算を防ぐ
  const displayPapers = useMemo(
    () => (isSearchActive ? [...searchResultPapers, ...papersExcludedFromSearch] : papers),
    [isSearchActive, searchResultPapers, papersExcludedFromSearch, papers]
  );

  // 検索結果の件数の内訳（検索済みの値から導出し、件数表示のために検索APIは呼ばない）。
  // 出すのは現在の検索の結果が確定し（resultsReady: 失敗・中止の stub や読み込み途中の結果を含まない）、
  // クエリEmbeddingで類似度を計算したときだけ。
  // 新しい検索の実行中・失敗時に前回の結果を表示している間は出さない（前回の結果は新しい検索の進行中は
  // しきい値の変更に追従せず、新しい検索の状態と混ざるため。前回の結果であることは検索欄の近くに出る）
  // previousResultsQuery === null は防御（resultsReady なら前回の結果の表示中ではないが、
  // 状態の定義が変わっても前回の結果に内訳を付けないため明示する）
  // 確定した結果の再計算が失敗している間も出さない（表示中の結果は更新前の論文・しきい値で計算したもので、
  // 現在のしきい値・論文の件数として読めないため。理由は検索欄の近くに出る）
  const hasComputedCandidates =
    resultsReady &&
    previousResultsQuery === null &&
    queryEmbedding !== null &&
    recomputeError === null;
  const searchResultCounts = useMemo(
    () =>
      hasComputedCandidates
        ? {
            candidateCount: totalMatchCount,
            topCount: results.length,
            excludedCount: papersExcludedFromSearch.length,
          }
        : undefined,
    [hasComputedCandidates, totalMatchCount, results.length, papersExcludedFromSearch.length]
  );

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background bg-gradient-bold bg-particles">
      {/* スキップリンク（ページで最初の Tab の到達先。ヘッダー・サイドバーを通らずに検索欄・論文一覧へ移る） */}
      <SkipLinks />

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
        // 全件の準備完了までは追加同期しない（読み込み途中の件数を既存論文数として使わないため）
        onRequestSync={hasMorePapers && arePapersReady ? syncMore : undefined}
        emptySearchMessage={emptySearchMessage}
        isSearchLoading={isLoading}
        expandedPaperId={isDesktop ? (selectedPaper?.id ?? null) : null}
        renderExpandedDetail={
          isDesktop
            ? (paper) => (
                <Suspense fallback={<div className="p-6">読み込み中...</div>}>
                  <PaperDetail
                    paper={paper}
                    summary={adoptedSummaries.get(paper.id)}
                    onGenerateSummary={handleGenerateSummary}
                    isSummaryLoading={isSummaryLoading}
                    summaryError={summaryError}
                    summaryFailedTarget={summaryFailedTarget}
                    summaryGeneratingTarget={summaryGeneratingTarget}
                    selectedSummaryLanguage={summaryLanguage}
                    onSummaryLanguageChange={handleSummaryLanguageChange}
                    autoGenerateSummary={autoGenerateSummary}
                    // 展開中の論文は選択中の論文（usePaperSummary の対象）と同じ
                    summaryVersions={summaryVersions}
                    onAdoptSummaryVersion={adoptSummaryVersion}
                    onDiscardSummaryVersion={discardSummaryVersion}
                    onSaveSummaryCorrection={saveSummaryCorrection}
                  />
                </Suspense>
              )
            : undefined
        }
        expandedQuery={displayExpandedQuery}
        onSearchWithEditedText={handleSearchWithEditedText}
        results={results}
        hasQueryEmbedding={queryEmbedding !== null}
        searchResultCounts={searchResultCounts}
        isLoading={isLoading}
        isWaitingForPapers={isWaitingForPapers}
        selectedPaper={selectedPaper}
        onCloseDetail={handleCloseDetail}
        currentSummary={currentSummary}
        onGenerateSummary={handleGenerateSummary}
        isSummaryLoading={isSummaryLoading}
        summaryError={summaryError}
        summaryFailedTarget={summaryFailedTarget}
        summaryGeneratingTarget={summaryGeneratingTarget}
        summaryLanguage={summaryLanguage}
        onSummaryLanguageChange={handleSummaryLanguageChange}
        autoGenerateSummary={autoGenerateSummary}
        summaryVersions={summaryVersions}
        onAdoptSummaryVersion={adoptSummaryVersion}
        onDiscardSummaryVersion={discardSummaryVersion}
        onSaveSummaryCorrection={saveSummaryCorrection}
        searchHistories={histories}
        onReSearch={handleReSearch}
        historyUndo={historyUndo}
        hasMore={hasMorePapers}
        onSyncAll={syncAll}
        onRunEmbeddingBackfill={runEmbeddingBackfill}
        onStopSync={handleStopSync}
        onSync={syncPapers}
        onRetrySync={retrySync}
        isSyncPending={isAutoSyncPending}
        onOpenSettings={() => setIsSettingsOpen(true)}
        previousResultsQuery={previousResultsQuery}
        searchStatus={
          pendingQuery !== null ? (
            <SearchStatusPanel
              query={pendingQuery}
              isLoading={isLoading}
              error={searchError}
              previousQuery={previousResultsQuery}
              onCancel={handleCancelSearch}
              onRetry={handleRetrySearch}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />
          ) : recomputeError !== null && resultQuery !== null ? (
            // 確定した結果の再計算の失敗（新しい検索の失敗と区別し、再計算だけを再試行する）
            <SearchStatusPanel
              query={resultQuery}
              isLoading={false}
              error={recomputeError}
              previousQuery={null}
              isRecomputeFailure
              onRetry={handleRetrySearch}
            />
          ) : null
        }
      />

      {/* Footer */}
      <HomeFooter />
    </div>
  );
};
