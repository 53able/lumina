import { type FC, lazy, memo, type ReactNode, Suspense } from "react";
import type {
  ExpandedQuery,
  Paper,
  PaperSummary,
  SearchHistory as SearchHistoryType,
} from "../../shared/schemas/index";
import type { SearchHistoryUndo } from "../hooks/useSearchHistoryUndo";
import type { GenerateTarget } from "../lib/api";
import type { SearchResultCounts } from "../lib/searchCounts";
import { isEditedSearchText, isExcludedTerm, uniqueTerms } from "../lib/searchTextTerms";
import type { SummaryVersion } from "../stores/summaryStore";
import { MobileSearchHistory } from "./MobileSearchHistory";
import { PaperExplorer } from "./PaperExplorer";
import { PaperLoadStatus } from "./PaperLoadStatus";
import { SearchHistory } from "./SearchHistory";
import { SearchTextEditor } from "./SearchTextEditor";
import { SearchThresholdControl } from "./SearchThresholdControl";
import { SyncStatusBar } from "./SyncStatusBar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet.js";

// 動的インポート（バンドルサイズ最適化）
const PaperDetail = lazy(() => import("./PaperDetail").then((m) => ({ default: m.PaperDetail })));

/**
 * HomeMain のProps
 */
interface HomeMainProps {
  /** デスクトップかどうか */
  isDesktop: boolean;
  /** 表示する論文リスト */
  displayPapers: Paper[];
  /** 検索ハンドラー */
  onSearch: (query: string) => Promise<Paper[]>;
  /** 検索クリアハンドラー */
  onClearSearch: () => void;
  /** 論文クリックハンドラー */
  onPaperClick: (paper: Paper) => void;
  /** 外部クエリ */
  externalQuery: string | null;
  /** 検索入力値 */
  searchInputValue: string;
  /** 検索入力変更ハンドラー */
  onSearchInputChange: (value: string) => void;
  /** whyReadMap */
  whyReadMap: Map<string, string>;
  /** 追加同期リクエスト */
  onRequestSync?: () => void;
  /** 空検索メッセージ */
  emptySearchMessage?: ReactNode;
  /** 検索ローディング中かどうか */
  isSearchLoading: boolean;
  /** 展開中の論文ID */
  expandedPaperId: string | null;
  /** 展開中の詳細をレンダリング */
  renderExpandedDetail?: (paper: Paper) => ReactNode;
  /** 拡張クエリ（編集文での再検索中・失敗時は送信した編集内容） */
  expandedQuery: ExpandedQuery | null;
  /** 確認・編集した検索文（Embedding に渡す文）で再検索するハンドラー */
  onSearchWithEditedText?: (searchText: string) => void;
  /** 検索結果 */
  results: Array<{ paper: Paper; score: number }>;
  /** 表示中の検索にクエリEmbeddingがあるか（ない検索ではしきい値を適用できない） */
  hasQueryEmbedding?: boolean;
  /** 検索ローディング中かどうか */
  isLoading: boolean;
  /** 検索が保存済み論文の全件準備を待っているか */
  isWaitingForPapers?: boolean;
  /** 検索結果の候補・上位・対象外の件数（検索が完了している間だけ渡す） */
  searchResultCounts?: SearchResultCounts;
  /** 選択中の論文 */
  selectedPaper: Paper | null;
  /** 詳細を閉じる */
  onCloseDetail: () => void;
  /** 現在のサマリー */
  currentSummary: PaperSummary | undefined;
  /** サマリー生成ハンドラー */
  onGenerateSummary: (
    paperId: string,
    language: "ja" | "en",
    target?: GenerateTarget
  ) => Promise<void>;
  /** サマリーローディング中かどうか */
  isSummaryLoading: boolean;
  /** 直近のサマリー生成エラー */
  summaryError: Error | null;
  /** 直近に失敗した生成の対象（説明文だけの失敗を区別するため） */
  summaryFailedTarget: GenerateTarget | null;
  /** 生成中の生成の対象（押した生成ボタンだけに生成中を表示するため） */
  summaryGeneratingTarget: GenerateTarget | null;
  /** 選択中のサマリー言語 */
  summaryLanguage: "ja" | "en";
  /** サマリー言語変更ハンドラー */
  onSummaryLanguageChange: (language: "ja" | "en") => void;
  /** 自動生成サマリーかどうか */
  autoGenerateSummary: boolean;
  /** 現在の論文・言語の保存済みの要約の版（古い順） */
  summaryVersions?: SummaryVersion[];
  /** 要約の版を採用版にする */
  onAdoptSummaryVersion?: (id: number) => Promise<void>;
  /** 要約の版を破棄する */
  onDiscardSummaryVersion?: (id: number) => Promise<void>;
  /** 要約の版に利用者の訂正文を保存する（空なら訂正を削除する） */
  onSaveSummaryCorrection?: (id: number, text: string) => Promise<void>;
  /** 検索履歴（すべて。新しい順。表示件数は SearchHistory で絞る） */
  searchHistories: SearchHistoryType[];
  /** 再検索ハンドラー */
  onReSearch: (history: SearchHistoryType) => void;
  /** 履歴の削除と取り消し（操作と結果） */
  historyUndo?: SearchHistoryUndo;
  /** まだ取得可能な論文があるか */
  hasMore?: boolean;
  /** 同期期間の論文をすべて取得する */
  onSyncAll?: () => void | Promise<void>;
  /** Embeddingバックフィル実行 */
  onRunEmbeddingBackfill: () => void;
  /** 同期を停止する（取得中のみ有効）。SyncStatusBar の停止ボタンから呼ぶ */
  onStopSync?: () => void;
  /** 同期する（未同期時の空表示から呼ぶ） */
  onSync?: () => void;
  /** 失敗した同期をやり直す（同期エラー表示・同期失敗時の空表示から呼ぶ） */
  onRetrySync?: () => void;
  /** 初回の自動同期を予定しているか */
  isSyncPending?: boolean;
  /** 設定ダイアログを開く（未同期時の空表示から呼ぶ） */
  onOpenSettings?: () => void;
  /** 新しい検索の実行中・失敗時に表示している前回の結果のクエリ（それ以外は null） */
  previousResultsQuery?: string | null;
  /** 検索欄の直下に出す検索の状態（実行中・失敗と、その操作） */
  searchStatus?: ReactNode;
}

/**
 * HomeMain - ホームページのメインコンテンツコンポーネント
 *
 * 責務:
 * - サイドバー（同期ステータス・検索履歴。モバイルの検索履歴は検索欄の手前の折りたたみ、同期ステータスは一覧の下）
 * - メインコンテンツ（PaperExplorer、詳細パネル）
 * - モバイル用Sheet（論文詳細）
 *
 * React Best Practice: memo でラップし、App の不要な再レンダー時にサブツリーの再描画を抑制する（rerender-memo）。
 */
const HomeMainInner: FC<HomeMainProps> = ({
  isDesktop,
  displayPapers,
  onSearch,
  onClearSearch,
  onPaperClick,
  externalQuery,
  searchInputValue,
  onSearchInputChange,
  whyReadMap,
  onRequestSync,
  emptySearchMessage,
  isSearchLoading,
  expandedPaperId,
  renderExpandedDetail,
  expandedQuery,
  onSearchWithEditedText,
  results,
  hasQueryEmbedding = false,
  isLoading,
  isWaitingForPapers = false,
  searchResultCounts,
  selectedPaper,
  onCloseDetail,
  currentSummary,
  onGenerateSummary,
  isSummaryLoading,
  summaryError,
  summaryFailedTarget,
  summaryGeneratingTarget,
  summaryLanguage,
  onSummaryLanguageChange,
  autoGenerateSummary,
  summaryVersions,
  onAdoptSummaryVersion,
  onDiscardSummaryVersion,
  onSaveSummaryCorrection,
  searchHistories,
  onReSearch,
  historyUndo,
  hasMore,
  onSyncAll,
  onRunEmbeddingBackfill,
  onStopSync,
  onSync,
  onRetrySync,
  isSyncPending,
  onOpenSettings,
  previousResultsQuery = null,
  searchStatus,
}) => {
  return (
    <>
      {/* Mobile: 論文詳細 Sheet (lg未満で表示) */}
      <Sheet open={!isDesktop && !!selectedPaper} onOpenChange={(open) => !open && onCloseDetail()}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>論文詳細</SheetTitle>
            <SheetDescription>選択した論文の詳細情報</SheetDescription>
          </SheetHeader>
          {selectedPaper ? (
            <Suspense fallback={<div className="p-6">読み込み中...</div>}>
              <PaperDetail
                paper={selectedPaper}
                summary={currentSummary}
                onGenerateSummary={onGenerateSummary}
                isSummaryLoading={isSummaryLoading}
                summaryError={summaryError}
                summaryFailedTarget={summaryFailedTarget}
                summaryGeneratingTarget={summaryGeneratingTarget}
                selectedSummaryLanguage={summaryLanguage}
                onSummaryLanguageChange={onSummaryLanguageChange}
                autoGenerateSummary={autoGenerateSummary}
                summaryVersions={summaryVersions}
                onAdoptSummaryVersion={onAdoptSummaryVersion}
                onDiscardSummaryVersion={onDiscardSummaryVersion}
                onSaveSummaryCorrection={onSaveSummaryCorrection}
              />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Main Layout: Sidebar + List + Detail (Master-Detail Pattern) */}
      <div className="flex min-h-0 relative">
        {/* Sidebar - 同期ステータスと検索履歴（デスクトップのみ。モバイルの検索履歴は検索欄の手前の折りたたみ）
            表示は CSS の lg ではなく isDesktop だけで決める（既定の文字サイズが 16px でない環境で、入口が消えたり二重になったりしないように）。
            サイドバーと折りたたみは同時にマウントしない（通知・フォーカス先の重複を防ぐ）。
            画面幅を切り替えると SearchHistory が作り直され、処理中の削除・元に戻すの完了通知とフォーカス移動は行わない（結果は行内の表示に残る） */}
        {isDesktop ? (
          <aside className="flex w-64 flex-col border-r border-border/60 bg-sidebar/50 relative z-10">
            {/* 同期（補助領域）: 検索欄より上に置かず、サイドバーの先頭で進行中・停止・失敗を見せる */}
            <section aria-label="同期" className="px-4 pt-6">
              <SyncStatusBar
                compact
                hasMore={hasMore}
                onSyncAll={onSyncAll}
                onRunEmbeddingBackfill={onRunEmbeddingBackfill}
                onStopSync={onStopSync}
                onRetrySync={onRetrySync}
              />
            </section>
            <div className="px-6 pt-3 pb-4">
              <h3
                className="text-sm font-bold uppercase tracking-wider text-primary-light"
                style={{ opacity: 1 }}
              >
                検索履歴
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              <Suspense
                fallback={<div className="p-4 text-sm text-muted-foreground">読み込み中...</div>}
              >
                <SearchHistory
                  histories={searchHistories}
                  onReSearch={onReSearch}
                  undo={historyUndo}
                  compact
                />
              </Suspense>
            </div>
          </aside>
        ) : null}

        {/* Main Content - 論文リスト（モバイルはオブジェクトファーストで一覧を上に） */}
        <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto min-w-0 relative z-10">
          <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-12 lg:py-10">
            {/* 同期ステータスは補助領域に置く（デスクトップはサイドバー、モバイルは一覧の下）。検索欄より上には出さない */}

            {/* 保存済み論文の読み込み状態（読み込み中の件数・失敗時の再試行） */}
            <PaperLoadStatus />

            {/* モバイル: 検索履歴は検索欄の手前の折りたたみ（一覧を覆わない） */}
            {!isDesktop && (
              <MobileSearchHistory
                histories={searchHistories}
                onReSearch={onReSearch}
                undo={historyUndo}
              />
            )}

            {/* 拡張クエリ情報の表示 - ロジック駆動: 関連要素は近くに */}
            {expandedQuery ? (
              <div className="mb-4 rounded-xl bg-muted/30 border-2 border-primary/30 p-6 backdrop-blur-sm shadow-lg shadow-primary/10">
                <p className="text-sm" style={{ opacity: 1 }}>
                  <span className="font-bold text-primary-light" style={{ opacity: 1 }}>
                    検索クエリ:
                  </span>{" "}
                  <span style={{ opacity: 0.95 }}>{expandedQuery.original}</span>
                  {expandedQuery.original !== expandedQuery.english ? (
                    <span className="ml-2 text-primary font-bold" style={{ opacity: 1 }}>
                      → {expandedQuery.english}
                    </span>
                  ) : null}
                  {isEditedSearchText(expandedQuery) ? (
                    <span className="ml-2 rounded border border-primary/50 px-1.5 py-0.5 text-xs">
                      検索文を編集済み
                    </span>
                  ) : null}
                </p>
                {expandedQuery.synonyms.length > 0 ? (
                  <p className="text-xs mt-2" style={{ opacity: 0.7 }}>
                    関連語:{" "}
                    {uniqueTerms(expandedQuery.synonyms).map((term, index) => (
                      <span key={term}>
                        {index > 0 ? ", " : null}
                        {isExcludedTerm(expandedQuery, term) ? (
                          <>
                            <span className="line-through">{term}</span>（除外）
                          </>
                        ) : (
                          term
                        )}
                      </span>
                    ))}
                  </p>
                ) : null}
                {onSearchWithEditedText ? (
                  <SearchTextEditor
                    // 検索が変わったら（再検索の完了・同じ検索文の別検索も含む）編集状態を表示中の検索から作り直す
                    key={`${expandedQuery.original}\n${expandedQuery.english}\n${expandedQuery.searchText}`}
                    expandedQuery={expandedQuery}
                    onSubmit={onSearchWithEditedText}
                    isLoading={isLoading}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Paper Explorer */}
            <PaperExplorer
              initialPapers={displayPapers}
              onSearch={onSearch}
              onClear={onClearSearch}
              onPaperClick={onPaperClick}
              externalQuery={externalQuery}
              searchInputValue={searchInputValue}
              onSearchInputChange={onSearchInputChange}
              whyReadMap={whyReadMap}
              onRequestSync={onRequestSync}
              emptySearchMessage={emptySearchMessage}
              isSearchLoading={isSearchLoading}
              onSync={onSync}
              onRetrySync={onRetrySync}
              isSyncPending={isSyncPending}
              onOpenSettings={onOpenSettings}
              previousResultsQuery={previousResultsQuery}
              searchStatus={searchStatus}
              // インライン展開（デスクトップのみ）
              expandedPaperId={expandedPaperId}
              renderExpandedDetail={renderExpandedDetail}
              searchResultCounts={searchResultCounts}
              // しきい値は件数の隣で結果を見ながら調整する（検索APIは呼ばず表示中の結果に即時反映）
              // 前回の結果を表示している間（新しい検索の実行中・失敗時）は出さない。前回の結果はその時点の確定結果で、
              // しきい値を変えても再計算しない（前結果を見る・新しい検索の完了後に調整する）
              renderSearchResultTools={
                expandedQuery && previousResultsQuery === null
                  ? (displayedCount) => (
                      <SearchThresholdControl
                        // 検索が変わったら通知状態をリセットする
                        key={`${expandedQuery.original}\n${expandedQuery.searchText}`}
                        displayedCount={displayedCount}
                        canApply={hasQueryEmbedding}
                        defaultOpen={isDesktop}
                      />
                    )
                  : undefined
              }
            />

            {/* ローディング中の検索結果表示（前回の結果を表示している間は一覧を残すため出さない） */}
            {isLoading && previousResultsQuery === null && results.length === 0 ? (
              <div className="mt-12 grid place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-12 w-12 animate-loading-bold rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground font-bold">
                    {isWaitingForPapers
                      ? "保存済みの論文を読み込み中です。完了後に検索結果を表示します"
                      : "検索中..."}
                  </p>
                </div>
              </div>
            ) : null}

            {/* モバイル: 同期ステータスは一覧の下（論文一覧をファーストビューに） */}
            {!isDesktop && (
              <SyncStatusBar
                compact
                hasMore={hasMore}
                onSyncAll={onSyncAll}
                onRunEmbeddingBackfill={onRunEmbeddingBackfill}
                onStopSync={onStopSync}
                onRetrySync={onRetrySync}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
};

export const HomeMain = memo(HomeMainInner);
