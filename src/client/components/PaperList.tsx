import { CheckCircle2, Loader2, Search } from "lucide-react";
import { type FC, type ReactNode, useCallback, useEffect, useRef } from "react";
import type { Paper } from "../../shared/schemas/index";
import { useGridVirtualizer } from "../hooks/useGridVirtualizer";
import { cn } from "../lib/utils";
import { PaperCard } from "./PaperCard";
import { Card } from "./ui/card";

/** カードの最小幅（px） */
const MIN_CARD_WIDTH = 300;

/** グリッドのギャップ（px） */
const GRID_GAP = 32;

/** 通常行の推定高さ（px）- 仮想スクロールの初期計算用。実際の高さは measureElement で測定 */
const ESTIMATED_ROW_HEIGHT = 252;

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
  /** 0件時に表示するメッセージ（未指定時はデフォルトの「論文が見つかりません」） */
  emptyMessage?: ReactNode;
  /** 論文数を表示するか */
  showCount?: boolean;
  /** カードクリック時のコールバック */
  onPaperClick?: (paper: Paper) => void;
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

/**
 * 空の状態メッセージ - Super Centered
 * @param customMessage 未指定時は文脈に応じてデフォルトメッセージを表示
 * @param isSyncing 同期中の場合、検索向けメッセージではなく「取得中」を表示する
 */
const EmptyMessage: FC<{ customMessage?: ReactNode; isSyncing?: boolean }> = ({
  customMessage,
  isSyncing = false,
}) => (
  <div className="grid place-items-center min-h-[300px]">
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="h-16 w-16 rounded-full bg-muted/50 grid place-items-center">
        {isSyncing ? (
          <Loader2 className="h-8 w-8 text-muted-foreground/50 animate-loading-bold" />
        ) : (
          <Search className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="space-y-1">
        {customMessage ?? (isSyncing ? (
          <p className="text-lg text-muted-foreground">論文を取得しています...</p>
        ) : (
          <>
            <p className="text-lg text-muted-foreground">論文が見つかりません</p>
            <p className="text-sm text-muted-foreground/70">検索条件を変更してお試しください</p>
          </>
        ))}
      </div>
    </div>
  </div>
);

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
  onPaperClick,
  whyReadMap = new Map(),
  onRequestSync,
  isSyncing = false,
  expandedPaperId = null,
  renderExpandedDetail,
}) => {
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
      {showCount && (
        <p className="text-sm text-muted-foreground/70">
          <span className="font-bold text-foreground">{papers.length}</span>件の論文
        </p>
      )}

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
            {/* 仮想化された行をレンダリング */}
            {virtualRows.map((virtualRow) => {
              const { index, start, items: rowItems, isExpanded } = virtualRow;

              return (
                <div
                  key={`row-${index}`}
                  data-index={index}
                  ref={measureElement}
                  className="absolute left-0 right-0"
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
                          index={(() => {
                            const foundIndex = papers.findIndex((p) => p.id === rowItems[0].id);
                            return foundIndex >= 0 ? foundIndex : undefined;
                          })()}
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
                        const actualIndex = papers.findIndex((p) => p.id === paper.id);
                        const finalIndex = actualIndex >= 0 ? actualIndex : undefined;
                        return (
                          <div
                            key={getPaperId(paper)}
                            className="min-w-0 animate-card-stagger"
                            style={{
                              animationDelay: `${(finalIndex !== undefined ? finalIndex : index * columnCount + colIndex) * 0.05}s`,
                              overflow: "visible",
                              /* カードが浮き上がっても文字が隠れないように十分な余白を確保 */
                              padding: "12px",
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
              <EmptyMessage customMessage={emptyMessageProp} isSyncing={isSyncing} />
            </div>
          ) : null}
        </div>
      </div>

      {/* 無限スクロール用のローダー / 全件表示完了メッセージ */}
      <div className="flex justify-center py-6" data-testid="paper-list-loader">
        {isSyncing ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-loading-bold text-primary" />
            <span className="font-bold">古い論文を取得中...</span>
          </div>
        ) : (
          // onRequestSync がない = 追加読み込み不可（検索/フィルタ中）の場合のみ表示
          // 追加読み込みが可能な状態では、まだデータがあるかもしれないので表示しない
          !onRequestSync &&
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
