import { CheckCircle2, Loader2, Search } from "lucide-react";
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import type { Paper } from "../../shared/schemas/index";
import { useGridVirtualizer } from "../hooks/useGridVirtualizer";
import {
  getPaperListEmptyState,
  type PaperListEmptyAction,
  type PaperListEmptyState,
} from "../lib/paperListEmptyState";
import { cn } from "../lib/utils";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSyncStore } from "../stores/syncStore";
import { PaperCard } from "./PaperCard";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

/** 論文一覧の領域の id（ページ先頭のスキップリンク「論文一覧へ移動」の移動先） */
export const PAPER_LIST_ID = "paper-list";

/** カードの最小幅（px） */
const MIN_CARD_WIDTH = 300;

/** グリッドのギャップ（px）。先頭の結果を画面内に多く収めるため控えめにする */
const GRID_GAP = 16;

/**
 * 通常行の推定高さ（px）- 仮想スクロールの初期計算用。実際の高さは measureElement で測定
 *
 * ビルド済みCSSをヘッドレス Chrome で実測した1セル（余白 4px 込み）の高さ（幅 350〜352px、3行のタイトル・著者4名・カテゴリ3つ）:
 * Abstract 抜粋のみ 340px、AI の一文あり 398px、Abstract なし 272px。多くの論文が該当する Abstract 抜粋のみの値を使う
 * AI の一文（whyRead）がある行は推定より約60px高く、Abstract がない行は約70px低い。差は measureElement の実測で補正する。
 * 行ごとの内容に応じた推定は PR #24（Pretext による行の高さの推定）で見直す
 */
const ESTIMATED_ROW_HEIGHT = 340;

/** 展開行の推定高さ（px）- 仮想スクロールの初期計算用。実際の高さは measureElement で測定 */
const ESTIMATED_EXPANDED_ROW_HEIGHT = 400;

/**
 * PaperList コンポーネントのProps
 */
interface PaperListProps {
  /** 論文データの配列 */
  papers: Paper[];
  /** ローディング状態（検索入力欄のローディングなど） */
  isLoading?: boolean;
  /** 検索処理中のローディング状態（useSemanticSearchのisLoading） */
  isSearchLoading?: boolean;
  /** 検索0件時に表示するメッセージ（未指定時は状態に応じたデフォルト。論文が未取得のときは使わない） */
  emptyMessage?: ReactNode;
  /** 論文数を表示するか */
  showCount?: boolean;
  /** 件数の隣に置く操作（検索結果のしきい値など）。表示件数を受け取り、0件でも表示する */
  renderCountAccessory?: (displayedCount: number) => ReactNode;
  /** カードクリック時のコールバック */
  onPaperClick?: (paper: Paper) => void;
  /** 論文ID → whyRead のマップ */
  whyReadMap?: Map<string, string>;
  /** 追加同期リクエスト時のコールバック */
  onRequestSync?: () => void;
  /** 現在展開中の論文ID */
  expandedPaperId?: string | null;
  /** 展開中の論文の詳細コンテンツをレンダリング */
  renderExpandedDetail?: (paper: Paper) => ReactNode;
  /** 0件時の「論文を同期」 */
  onSync?: () => void;
  /** 0件時の「同期を再試行」（失敗した同期を同じ処理でやり直す） */
  onRetrySync?: () => void;
  /** 初回の自動同期を予定している（論文がこれから届くので0件の説明を「取得中」にする） */
  isSyncPending?: boolean;
  /** 0件時の「設定を開く」 */
  onOpenSettings?: () => void;
  /** 0件時の「検索・絞り込みを解除」 */
  onClearConditions?: () => void;
}

/**
 * ローディングスケルトン - RAMパターンでレスポンシブ
 */
const LoadingSkeleton: FC = () => (
  <div
    data-testid="paper-list-loading"
    className="grid gap-5"
    style={{
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
    }}
  >
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <Card key={i} className="h-44 animate-pulse bg-muted/40 rounded-xl border-border/20" />
    ))}
  </div>
);

/** 0件表示の操作ボタンの文言 */
const EMPTY_ACTION_LABELS: Record<PaperListEmptyAction, string> = {
  sync: "論文を同期",
  "retry-sync": "同期を再試行",
  "retry-load": "読み込みを再試行",
  "open-settings": "設定を開く",
  "clear-conditions": "検索・絞り込みを解除",
};

/**
 * 空の状態メッセージ - Super Centered
 * 未同期・同期失敗・条件に一致しない、を区別し、状態に合う操作を並べる。
 * @param customMessage 検索0件時の理由（APIキー未設定など）。論文が保存済みのときだけ使う
 * @param handlers 操作ごとのハンドラ（未指定の操作はボタンを出さない）
 */
const EmptyMessage: FC<{
  state: PaperListEmptyState;
  customMessage?: ReactNode;
  handlers: Partial<Record<PaperListEmptyAction, () => void>>;
}> = ({ state, customMessage, handlers }) => {
  const actions = state.actions.filter((action) => handlers[action]);
  return (
    <div className="grid place-items-center min-h-[300px]">
      <div
        className="flex flex-col items-center gap-3 text-center"
        data-testid="paper-list-empty"
        data-kind={state.kind}
      >
        <div className="h-16 w-16 rounded-full bg-muted/50 grid place-items-center">
          {state.kind === "loading" ? (
            <Loader2 className="h-8 w-8 text-muted-foreground/50 animate-loading-bold" />
          ) : (
            <Search className="h-8 w-8 text-muted-foreground/50" />
          )}
        </div>
        <div className="space-y-1">
          {state.kind === "no-results" && customMessage ? (
            customMessage
          ) : (
            <>
              <p className="text-lg text-muted-foreground">{state.title}</p>
              {state.description ? (
                <p className="text-sm text-muted-foreground/70">{state.description}</p>
              ) : null}
              {state.detail ? (
                <p className="break-all text-xs text-muted-foreground/70">詳細: {state.detail}</p>
              ) : null}
            </>
          )}
        </div>
        {actions.length > 0 ? (
          <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
            {actions.map((action, i) => (
              <Button
                key={action}
                variant={i === 0 ? "default" : "outline"}
                size="sm"
                onClick={handlers[action]}
                className="min-h-[44px] h-auto px-3 py-2"
              >
                {EMPTY_ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * PaperList - 論文リストコンポーネント（仮想スクロール対応）
 *
 * @description
 * 大量の論文データを効率的に表示するため、@tanstack/react-virtual による
 * 行ベースの仮想スクロールを実装。画面外のDOM要素は描画されないため、
 * 数千件のデータでもスムーズにスクロール可能。
 *
 * 機能:
 * - 論文カードのグリッド表示（仮想スクロール）
 * - レスポンシブな列数（ウィンドウサイズに応じて自動調整）
 * - インライン展開（カードと詳細を横並び表示）
 * - 無限スクロールによる追加読み込み
 */
export const PaperList: FC<PaperListProps> = ({
  papers,
  isLoading = false,
  isSearchLoading = false,
  emptyMessage: emptyMessageProp,
  showCount = false,
  renderCountAccessory,
  onPaperClick,
  whyReadMap = new Map(),
  onRequestSync,
  expandedPaperId = null,
  renderExpandedDetail,
  onSync,
  onRetrySync,
  isSyncPending = false,
  onOpenSettings,
  onClearConditions,
}) => {
  const isFetching = useSyncStore((s) => s.isFetching);
  const isLoadingMore = useSyncStore((s) => s.isLoadingMore);
  const isSyncing = isFetching || isLoadingMore;
  const lastSyncError = useSyncStore((s) => s.lastSyncError);
  const isSavingSyncedPapers = useSyncStore((s) => (s.savingSyncedPapersCount ?? 0) > 0);
  const isSyncingAll = useSyncStore((s) => s.isSyncingAll);
  const isSyncingFromDate = useSyncStore((s) => s.isSyncingFromDate);
  const storedPaperCount = usePaperStore((s) => s.papers.length);
  // IndexedDB からの初期読み込み中（initializePaperStore が true にする）
  const isPaperStoreLoading = usePaperStore((s) => s.isLoading);
  const paperLoadStatus = usePaperStore((s) => s.loadStatus);
  const paperLoadError = usePaperStore((s) => s.loadError);
  const retryPaperLoad = usePaperStore((s) => s.retryLoad);
  const hasSynced = useSettingsStore((s) => s.lastSyncedAt !== null);

  // スクロールコンテナへの参照
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // グリッドコンテナへの参照（幅計算用）
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // 仮想スクロール用フック
  const { virtualRows, totalSize, columnCount, measureElement } = useGridVirtualizer({
    scrollContainerRef,
    items: papers,
    getItemId: (paper) => paper.id,
    expandedItemId: expandedPaperId,
    minItemWidth: MIN_CARD_WIDTH,
    rowGap: GRID_GAP,
    columnGap: GRID_GAP,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT,
    estimatedExpandedRowHeight: ESTIMATED_EXPANDED_ROW_HEIGHT,
    overscan: 3,
  });

  // 無限スクロール用の ref（状態変化で observer を再作成しないため）
  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;

  const onRequestSyncRef = useRef(onRequestSync);
  onRequestSyncRef.current = onRequestSync;

  // 注: IntersectionObserver は削除。仮想スクロールコンテナ外のローダーでは
  // 初期レンダリング時に即発火してしまうため、スクロールイベントのみで制御する。

  // Paper IDを取得するコールバック（メモ化）
  const getPaperId = useCallback((paper: Paper) => paper.id, []);

  const paperIndexById = useMemo(() => {
    const entries = papers.map((paper, index) => [paper.id, index] as const);
    return new Map(entries);
  }, [papers]);

  const getPaperIndex = useCallback(
    (paper: Paper): number | undefined => paperIndexById.get(paper.id),
    [paperIndexById]
  );

  const showing: "skeleton" | "empty" | "grid" = isLoading
    ? "skeleton"
    : papers.length === 0
      ? "empty"
      : "grid";

  // 検索0件→一覧復帰時: 仮想スクロールコンテナを先頭にスクロール
  const prevShowingForScrollRef = useRef<"skeleton" | "empty" | "grid">(showing);
  useEffect(() => {
    if (prevShowingForScrollRef.current === "empty" && showing === "grid") {
      requestAnimationFrame(() => scrollContainerRef.current?.scrollTo(0, 0));
    }
    prevShowingForScrollRef.current = showing;
  }, [showing]);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {showCount || renderCountAccessory ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {showCount ? (
            <p className="text-sm text-muted-foreground/70">
              {/* 読み込み中は全件の件数と誤解させない */}
              {paperLoadStatus === "loading" && "読み込み済みの論文のうち "}
              <span className="font-bold text-foreground">{papers.length}</span>件の論文
            </p>
          ) : null}
          {renderCountAccessory?.(papers.length)}
        </div>
      ) : null}

      {/* 仮想スクロールコンテナ（0件でも常にマウントし、検索0件→一覧復帰でグリッドがアンマウントされないようにする） */}
      <div
        ref={scrollContainerRef}
        className="relative w-full min-w-0 overflow-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
        onScroll={(e) => {
          const target = e.currentTarget;
          const scrollTop = target.scrollTop;
          const scrollHeight = target.scrollHeight;
          const clientHeight = target.clientHeight;
          const isNearBottom = scrollHeight - scrollTop - clientHeight < 300;
          // 仮想スクロールコンテナ内で末尾に近づいたら追加読み込み
          if (isNearBottom && onRequestSyncRef.current && !isSyncingRef.current) {
            onRequestSyncRef.current();
          }
        }}
      >
        <div className={cn("relative w-full min-h-0", papers.length === 0 && "min-h-[300px]")}>
          {/* グリッドコンテナを常に先頭に置き、0件でもアンマウントしない（検索0件→一覧復帰でレイアウトが崩れないようにする） */}
          <div
            ref={gridContainerRef}
            className="relative w-full"
            style={{ height: `${totalSize}px` }}
          >
            {/* 仮想化された行をレンダリング（content-visibility でオフスクリーン行の描画を遅延） */}
            {virtualRows.map((virtualRow) => {
              const { index, start, items: rowItems, isExpanded } = virtualRow;

              return (
                <div
                  key={`row-${index}`}
                  data-index={index}
                  ref={measureElement}
                  className="absolute left-0 right-0 [content-visibility:auto] [contain-intrinsic-size:0_340px]"
                  style={{
                    top: `${start}px`,
                    zIndex: isExpanded ? 10 : 1,
                  }}
                >
                  {isExpanded && rowItems[0] ? (
                    // 展開行: 全幅でカードと詳細を横並び（高さはコンテンツに合わせる）
                    <div
                      className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_2fr] animate-in fade-in duration-300 p-1"
                      style={{ minHeight: `${ESTIMATED_EXPANDED_ROW_HEIGHT}px` }}
                    >
                      {/* 左側: コンパクトなカード */}
                      <div className="lg:sticky lg:top-0 lg:self-start">
                        <PaperCard
                          paper={rowItems[0]}
                          onClick={onPaperClick}
                          whyRead={whyReadMap.get(getPaperId(rowItems[0]))}
                          isExpanded={true}
                          index={getPaperIndex(rowItems[0])}
                        />
                      </div>
                      {/* 右側: 詳細パネル（コンテンツに合わせた高さ） */}
                      {renderExpandedDetail && (
                        <div className="rounded-xl border border-primary/20 bg-card/80 backdrop-blur-sm shadow-lg">
                          {renderExpandedDetail(rowItems[0])}
                        </div>
                      )}
                    </div>
                  ) : (
                    // 通常行: 複数カードをグリッド表示
                    // RAMパターン応用: 列数は計算済み、幅は1frでブラウザに委譲
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                        gap: `${GRID_GAP}px`,
                      }}
                    >
                      {rowItems.map((paper, colIndex) => {
                        // 展開アイテムがある場合でも正しいナンバリングを保つため、
                        // 行インデックスベースの計算ではなく、元のpapers配列でのインデックスを使用
                        const finalIndex = getPaperIndex(paper);
                        return (
                          <div
                            key={getPaperId(paper)}
                            className="min-w-0 animate-card-stagger"
                            style={{
                              animationDelay: `${(finalIndex !== undefined ? finalIndex : index * columnCount + colIndex) * 0.05}s`,
                              overflow: "visible",
                              /* ホバー・選択時の枠線が隣のカードに隠れない程度の余白 */
                              padding: "4px",
                            }}
                          >
                            <PaperCard
                              paper={paper}
                              onClick={onPaperClick}
                              whyRead={whyReadMap.get(getPaperId(paper))}
                              isExpanded={false}
                              index={finalIndex}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* 0件時は EmptyMessage を絶対配置でオーバーレイ（グリッドの位置を変えずレイアウトを維持） */}
          {/* ローディング中は EmptyMessage を表示しない（ローディングインジケータと重複しないように） */}
          {papers.length === 0 && !isLoading && !isSearchLoading ? (
            <div className="absolute inset-0 pointer-events-none">
              <EmptyMessage
                state={getPaperListEmptyState({
                  storedPaperCount,
                  isLoading:
                    isSyncing ||
                    Boolean(isSyncingAll) ||
                    Boolean(isSyncingFromDate) ||
                    isSyncPending ||
                    isSavingSyncedPapers ||
                    isPaperStoreLoading,
                  lastSyncError: lastSyncError ?? null,
                  hasSynced,
                  paperLoadStatus,
                  paperLoadError,
                })}
                customMessage={emptyMessageProp}
                handlers={{
                  sync: onSync,
                  "retry-sync": onRetrySync,
                  "retry-load": () => void retryPaperLoad(),
                  "open-settings": onOpenSettings,
                  "clear-conditions": onClearConditions,
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* 無限スクロール用のローダー / 全件表示完了メッセージ */}
      {/* 0件で空状態メッセージ（例: APIキー必要）を表示しているときはフッターに「取得中」を出さない（表示の整合性） */}
      <div className="flex justify-center py-6" data-testid="paper-list-loader">
        {isSyncing && papers.length > 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-loading-bold text-primary" />
            <span className="font-bold">古い論文を取得中...</span>
          </div>
        ) : isSyncing ? null : (
          // onRequestSync がない = 追加読み込み不可（検索/フィルタ中）の場合のみ表示
          // 追加読み込みが可能な状態・保存済み論文の読み込み中・読み込み失敗時は、まだデータがあるかもしれないので表示しない
          !onRequestSync &&
          paperLoadStatus === "ready" &&
          papers.length > 50 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <span className="font-bold">すべての論文を表示しました</span>
            </div>
          )
        )}
      </div>
    </div>
  );
};
