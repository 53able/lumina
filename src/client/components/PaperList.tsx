import { CheckCircle2, Loader2, Search } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { PaperCard } from "@/client/components/PaperCard";
import { Card } from "@/client/components/ui/card";
import type { Paper } from "@/shared/schemas";

/** 1ページあたりの表示件数 */
const PAGE_SIZE = 50;

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
  /** いいねボタンクリック時のコールバック */
  onLike?: (paperId: string) => void;
  /** ブックマークボタンクリック時のコールバック */
  onBookmark?: (paperId: string) => void;
  /** いいね済みの論文IDセット */
  likedPaperIds?: Set<string>;
  /** ブックマーク済みの論文IDセット */
  bookmarkedPaperIds?: Set<string>;
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
    className="grid gap-4"
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
 * PaperList - 論文リストコンポーネント
 *
 * Design Docsに基づく機能:
 * - 論文カードのリスト表示（無限スクロール対応）
 * - 空の場合のメッセージ表示
 * - ローディング状態の表示
 */
export const PaperList: FC<PaperListProps> = ({
  papers,
  isLoading = false,
  showCount = false,
  onPaperClick,
  onLike,
  onBookmark,
  likedPaperIds = new Set(),
  bookmarkedPaperIds = new Set(),
  whyReadMap = new Map(),
  onRequestSync,
  isSyncing = false,
  expandedPaperId = null,
  renderExpandedDetail,
}) => {
  // 表示件数の状態管理（無限スクロール用）
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loaderRef = useRef<HTMLDivElement>(null);

  // すべての外部依存を ref で保持し、IntersectionObserver の再作成を防ぐ
  // これにより displayCount/papers.length/isSyncing が変化しても observer は維持され、
  // 連続発火（observer 再作成 → 要素がまだ画面内 → 即座に再発火）を防止する
  const isSyncingRef = useRef(isSyncing);
  isSyncingRef.current = isSyncing;

  const displayCountRef = useRef(displayCount);
  displayCountRef.current = displayCount;

  const papersLengthRef = useRef(papers.length);
  papersLengthRef.current = papers.length;

  const onRequestSyncRef = useRef(onRequestSync);
  onRequestSyncRef.current = onRequestSync;

  // papers が変わったら displayCount をリセット
  // papers配列の先頭ID + 長さで変更を検知
  const papersKey = `${papers[0]?.id ?? "empty"}-${papers.length}`;
  useEffect(() => {
    // papersKeyの変更をトリガーにリセット
    void papersKey; // biome: intentional dependency
    setDisplayCount(PAGE_SIZE);
  }, [papersKey]);

  // IntersectionObserver でスクロール末尾を検知して追加読み込み
  // すべての状態は ref 経由で参照し、依存配列は空（マウント時のみ observer 作成）
  // これにより observer の再作成を完全に防ぎ、連続発火バグを回避
  useEffect(() => {
    const loaderElement = loaderRef.current;
    if (!loaderElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          if (displayCountRef.current < papersLengthRef.current) {
            // ローカル論文がまだある → 表示件数を増やす
            setDisplayCount((prev) => Math.min(prev + PAGE_SIZE, papersLengthRef.current));
          } else if (onRequestSyncRef.current && !isSyncingRef.current) {
            // ローカル論文が尽きた → APIから追加取得
            onRequestSyncRef.current();
          }
        }
      },
      { rootMargin: "100px" } // 少し手前で発火させてスムーズに
    );

    observer.observe(loaderElement);
    return () => observer.disconnect();
  }, []);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (papers.length === 0) {
    return <EmptyMessage />;
  }

  // 表示用にスライス
  const displayedPapers = papers.slice(0, displayCount);
  const hasMore = displayCount < papers.length;

  return (
    <div className="space-y-4">
      {showCount && (
        <p className="text-sm text-muted-foreground/70">
          <span className="font-medium text-foreground">{papers.length}</span>件の論文
          {papers.length > PAGE_SIZE && (
            <span className="ml-2 text-muted-foreground/50">
              （{displayedPapers.length}件表示中）
            </span>
          )}
        </p>
      )}

      {/* RAMパターン: repeat(auto-fit, minmax(min(100%, 300px), 1fr)) */}
      {/* マソナリー風: グリッド構造を維持しつつ、展開時は横並びで詳細表示 */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
        }}
      >
        {displayedPapers.map((paper) => {
          const isExpanded = expandedPaperId === paper.id;
          return (
            <div
              key={paper.id}
              style={{
                // 展開時は全幅を占める
                gridColumn: isExpanded ? "1 / -1" : undefined,
              }}
            >
              {isExpanded ? (
                // 展開時: カードと詳細を横並び
                <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_2fr] animate-in fade-in duration-300">
                  {/* 左側: コンパクトなカード */}
                  <div className="lg:sticky lg:top-20 lg:self-start">
                    <PaperCard
                      paper={paper}
                      onClick={onPaperClick}
                      onLike={onLike}
                      onBookmark={onBookmark}
                      isLiked={likedPaperIds.has(paper.id)}
                      isBookmarked={bookmarkedPaperIds.has(paper.id)}
                      whyRead={whyReadMap.get(paper.id)}
                      isExpanded={isExpanded}
                    />
                  </div>
                  {/* 右側: 詳細パネル（スクロール可能） */}
                  {renderExpandedDetail && (
                    <div className="overflow-hidden rounded-xl border border-primary/20 bg-card/80 backdrop-blur-sm shadow-lg max-h-[70vh] overflow-y-auto">
                      {renderExpandedDetail(paper)}
                    </div>
                  )}
                </div>
              ) : (
                // 通常時: カードのみ
                <PaperCard
                  paper={paper}
                  onClick={onPaperClick}
                  onLike={onLike}
                  onBookmark={onBookmark}
                  isLiked={likedPaperIds.has(paper.id)}
                  isBookmarked={bookmarkedPaperIds.has(paper.id)}
                  whyRead={whyReadMap.get(paper.id)}
                  isExpanded={isExpanded}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 無限スクロール用のローダー / 全件表示完了メッセージ */}
      <div ref={loaderRef} className="flex justify-center py-6" data-testid="paper-list-loader">
        {hasMore || isSyncing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{isSyncing ? "古い論文を取得中..." : "読み込み中..."}</span>
          </div>
        ) : (
          papers.length > PAGE_SIZE && (
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
