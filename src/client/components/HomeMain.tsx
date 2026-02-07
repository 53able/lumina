import { type FC, lazy, type ReactNode, Suspense } from "react";
import type {
  ExpandedQuery,
  Paper,
  PaperSummary,
  SearchHistory as SearchHistoryType,
} from "../../shared/schemas/index";
import type { GenerateTarget } from "../lib/api";
import { PaperExplorer } from "./PaperExplorer";
import { SearchHistory } from "./SearchHistory";
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
  /** 同期中かどうか */
  isSyncing: boolean;
  /** 空検索メッセージ */
  emptySearchMessage?: ReactNode;
  /** 検索ローディング中かどうか */
  isSearchLoading: boolean;
  /** 展開中の論文ID */
  expandedPaperId: string | null;
  /** 展開中の詳細をレンダリング */
  renderExpandedDetail?: (paper: Paper) => ReactNode;
  /** 拡張クエリ */
  expandedQuery: ExpandedQuery | null;
  /** 検索結果 */
  results: Array<{ paper: Paper; score: number }>;
  /** 検索ローディング中かどうか */
  isLoading: boolean;
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
  /** 選択中のサマリー言語 */
  summaryLanguage: "ja" | "en";
  /** サマリー言語変更ハンドラー */
  onSummaryLanguageChange: (language: "ja" | "en") => void;
  /** 自動生成サマリーかどうか */
  autoGenerateSummary: boolean;
  /** 検索履歴 */
  recentHistories: SearchHistoryType[];
  /** 再検索ハンドラー */
  onReSearch: (history: SearchHistoryType) => void;
  /** 履歴削除ハンドラー */
  onDeleteHistory: (id: string) => void;
  /** まだ取得可能な論文があるか */
  hasMore?: boolean;
  /** 同期期間の論文をすべて取得する */
  onSyncAll?: () => void | Promise<void>;
  /** すべて取得実行中かどうか */
  isSyncingAll?: boolean;
  /** すべて取得の進捗（取得済み / 全件数） */
  syncAllProgress?: { fetched: number; total: number } | null;
  /** Embeddingバックフィル中かどうか */
  isEmbeddingBackfilling: boolean;
  /** Embeddingバックフィル進捗 */
  embeddingBackfillProgress: { completed: number; total: number } | null;
  /** Embeddingバックフィル実行 */
  onRunEmbeddingBackfill: () => void;
}

/**
 * HomeMain - ホームページのメインコンテンツコンポーネント
 *
 * 責務:
 * - サイドバー（検索履歴）
 * - メインコンテンツ（PaperExplorer、詳細パネル）
 * - モバイル用Sheet（論文詳細）
 */
export const HomeMain: FC<HomeMainProps> = ({
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
  isSyncing,
  emptySearchMessage,
  isSearchLoading,
  expandedPaperId,
  renderExpandedDetail,
  expandedQuery,
  results,
  isLoading,
  selectedPaper,
  onCloseDetail,
  currentSummary,
  onGenerateSummary,
  isSummaryLoading,
  summaryLanguage,
  onSummaryLanguageChange,
  autoGenerateSummary,
  recentHistories,
  onReSearch,
  onDeleteHistory,
  hasMore,
  onSyncAll,
  isSyncingAll,
  syncAllProgress,
  isEmbeddingBackfilling,
  embeddingBackfillProgress,
  onRunEmbeddingBackfill,
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
                selectedSummaryLanguage={summaryLanguage}
                onSummaryLanguageChange={onSummaryLanguageChange}
                autoGenerateSummary={autoGenerateSummary}
              />
            </Suspense>
          ) : null}
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
            <Suspense
              fallback={<div className="p-4 text-sm text-muted-foreground">読み込み中...</div>}
            >
              <SearchHistory
                histories={recentHistories}
                onReSearch={onReSearch}
                onDelete={onDeleteHistory}
                compact
              />
            </Suspense>
          </div>
        </aside>

        {/* Main Content - 論文リスト（モバイルはオブジェクトファーストで一覧を上に） */}
        <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto min-w-0 relative z-10">
          <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-12 lg:py-10">
            {/* デスクトップ: 同期ステータスは一覧の上。モバイル: 一覧の下に回すのでここでは出さない */}
            {isDesktop && (
              <SyncStatusBar
                hasMore={hasMore}
                onSyncAll={onSyncAll}
                isSyncingAll={isSyncingAll}
                syncAllProgress={syncAllProgress}
                isEmbeddingBackfilling={isEmbeddingBackfilling}
                embeddingBackfillProgress={embeddingBackfillProgress}
                onRunEmbeddingBackfill={onRunEmbeddingBackfill}
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
                </p>
                {expandedQuery.synonyms.length > 0 ? (
                  <p className="text-xs mt-2" style={{ opacity: 0.7 }}>
                    関連語: {expandedQuery.synonyms.join(", ")}
                  </p>
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
              isSyncing={isSyncing}
              emptySearchMessage={emptySearchMessage}
              isSearchLoading={isSearchLoading}
              // インライン展開（デスクトップのみ）
              expandedPaperId={expandedPaperId}
              renderExpandedDetail={renderExpandedDetail}
            />

            {/* ローディング中の検索結果表示 */}
            {isLoading && results.length === 0 ? (
              <div className="mt-12 grid place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-12 w-12 animate-loading-bold rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground font-bold">検索中...</p>
                </div>
              </div>
            ) : null}

            {/* モバイル: 同期ステータスは一覧の下（論文一覧をファーストビューに） */}
            {!isDesktop && (
              <SyncStatusBar
                compact
                hasMore={hasMore}
                onSyncAll={onSyncAll}
                isSyncingAll={isSyncingAll}
                syncAllProgress={syncAllProgress}
                isEmbeddingBackfilling={isEmbeddingBackfilling}
                embeddingBackfillProgress={embeddingBackfillProgress}
                onRunEmbeddingBackfill={onRunEmbeddingBackfill}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
};
