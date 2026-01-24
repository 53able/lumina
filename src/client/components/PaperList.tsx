import { CheckCircle2, Loader2, Search } from "lucide-react";
import { type FC, type ReactNode, useCallback, useRef } from "react";
import { PaperCard } from "./PaperCard";
import { Card } from "./ui/card";
import { useGridVirtualizer } from "../hooks/useGridVirtualizer";
import type { Paper } from "../../shared/schemas/index";

/** カードの最小幅（px） */
const MIN_CARD_WIDTH = 300;

/** グリッドのギャップ（px） */
const GRID_GAP = 20;

/** 通常行の推定高さ（px）- 仮想スクロールの初期計算用。実際の高さは measureElement で測定 */
const ESTIMATED_ROW_HEIGHT = 252;

/** 展開行の推定高さ（px）- 仮想スクロールの初期計算用。実際の高さは measureElement で測定 */
const ESTIMATED_EXPANDED_ROW_HEIGHT = 800;

/**
 * PaperList コンポーネントのProps
 */
interface PaperListProps {
  /** 論文データの配列 */
  papers: Paper[];
  /** ローディング状態 */
  isLoading?: boolean;
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
 */
const EmptyMessage: FC = () => (
  <div className="grid place-items-center min-h-[300px]">
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="h-16 w-16 rounded-full bg-muted/50 grid place-items-center">
        <Search className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-medium text-muted-foreground">論文が見つかりません</p>
        <p className="text-sm text-muted-foreground/70">検索条件を変更してお試しください</p>
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
    gridContainerRef,
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

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (papers.length === 0) {
    return <EmptyMessage />;
  }

  return (
    <div className="space-y-4">
      {showCount && (
        <p className="text-sm text-muted-foreground/70">
          <span className="font-medium text-foreground">{papers.length}</span>件の論文
        </p>
      )}

      {/* 仮想スクロールコンテナ */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-auto"
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
        {/* グリッドコンテナ（幅計算用） */}
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
                    {rowItems.map((paper, colIndex) => (
                      <PaperCard
                        key={getPaperId(paper)}
                        paper={paper}
                        onClick={onPaperClick}
                        whyRead={whyReadMap.get(getPaperId(paper))}
                        isExpanded={false}
                        index={index * columnCount + colIndex}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 無限スクロール用のローダー / 全件表示完了メッセージ */}
      <div className="flex justify-center py-6" data-testid="paper-list-loader">
        {isSyncing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>古い論文を取得中...</span>
          </div>
        ) : (
          // onRequestSync がない = 追加読み込み不可（検索/フィルタ中）の場合のみ表示
          // 追加読み込みが可能な状態では、まだデータがあるかもしれないので表示しない
          !onRequestSync &&
          papers.length > 50 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
              <CheckCircle2 className="h-4 w-4" />
              <span>すべての論文を表示しました</span>
            </div>
          )
        )}
      </div>
    </div>
  );
};
