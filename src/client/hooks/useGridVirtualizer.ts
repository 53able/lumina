import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";

/** グリッド仮想化の設定オプション */
interface UseGridVirtualizerOptions<T> {
  /** スクロールコンテナへの参照 */
  scrollContainerRef: RefObject<HTMLElement | null>;
  /** グリッドコンテナへの参照（幅計算用） */
  gridContainerRef: RefObject<HTMLElement | null>;
  /** アイテムの配列 */
  items: T[];
  /** アイテムのIDを取得する関数 */
  getItemId: (item: T) => string;
  /** 展開中のアイテムID（null = 展開なし） */
  expandedItemId: string | null;
  /** カードの最小幅（px） */
  minItemWidth?: number;
  /** 行間のギャップ（px） */
  rowGap?: number;
  /** 列間のギャップ（px） */
  columnGap?: number;
  /** 通常行の推定高さ（px） */
  estimatedRowHeight?: number;
  /** 展開行の推定高さ（px） */
  estimatedExpandedRowHeight?: number;
  /** オーバースキャン（画面外にレンダリングする追加行数） */
  overscan?: number;
}

/** 仮想化された行の情報 */
interface VirtualRow<T> {
  /** 行インデックス */
  index: number;
  /** 行の開始位置（px） */
  start: number;
  /** 行の高さ（px） */
  size: number;
  /** この行に含まれるアイテム */
  items: T[];
  /** 展開行かどうか */
  isExpanded: boolean;
}

/** useGridVirtualizer の戻り値 */
interface UseGridVirtualizerResult<T> {
  /** 仮想化された行の配列（可視範囲のみ） */
  virtualRows: VirtualRow<T>[];
  /** 全体のスクロール高さ（px） */
  totalSize: number;
  /** 現在の列数 */
  columnCount: number;
  /** 計算されたカード幅（px） */
  itemWidth: number;
  /** 要素の高さを測定するためのref設定関数 */
  measureElement: (element: HTMLElement | null) => void;
}

/**
 * グリッドレイアウト対応の仮想スクロールフック
 *
 * @description
 * - ResizeObserverでコンテナ幅を監視し、列数を動的に計算
 * - アイテムを行に分割し、行単位で仮想化
 * - 展開されたアイテムがある行は全幅で特別扱い
 *
 * @example
 * ```tsx
 * const { virtualRows, totalSize, columnCount, measureElement } = useGridVirtualizer({
 *   scrollContainerRef: scrollRef,
 *   gridContainerRef: containerRef,
 *   items: papers,
 *   getItemId: (paper) => paper.id,
 *   expandedItemId: selectedPaperId,
 * });
 * ```
 */
export const useGridVirtualizer = <T>({
  scrollContainerRef,
  gridContainerRef,
  items,
  getItemId,
  expandedItemId,
  minItemWidth = 300,
  rowGap = 16,
  columnGap = 16,
  estimatedRowHeight = 200,
  estimatedExpandedRowHeight = 500,
  overscan = 3,
}: UseGridVirtualizerOptions<T>): UseGridVirtualizerResult<T> => {
  // コンテナ幅の状態
  const [containerWidth, setContainerWidth] = useState(0);

  // ResizeObserverでコンテナ幅を監視
  useEffect(() => {
    const element = gridContainerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);
    // 初期幅を設定
    setContainerWidth(element.clientWidth);

    return () => observer.disconnect();
  }, [gridContainerRef]);

  // 列数とアイテム幅を計算
  // containerWidth が 0 の場合（テスト環境や初期レンダリング時）はフォールバック値を使用
  const { columnCount, itemWidth } = useMemo(() => {
    // フォールバック幅（SSRやテスト環境用）
    // 小数点以下を切り捨てて精度問題を回避
    const effectiveWidth = Math.floor(containerWidth > 0 ? containerWidth : 1200);

    // auto-fit 相当: コンテナ幅 / (最小幅 + ギャップ) で列数を計算
    // (containerWidth + columnGap) / (minItemWidth + columnGap) で正確に計算
    const cols = Math.max(1, Math.floor((effectiveWidth + columnGap) / (minItemWidth + columnGap)));

    // 実際のアイテム幅を計算（ギャップを考慮して均等分割）
    // Math.floor で切り捨てて、オーバーフローを防止
    const width = Math.floor((effectiveWidth - columnGap * (cols - 1)) / cols);

    return { columnCount: cols, itemWidth: Math.max(width, minItemWidth) };
  }, [containerWidth, minItemWidth, columnGap]);

  // アイテムを行に分割（展開アイテムは専用行）
  const rows = useMemo(() => {
    const result: { items: T[]; isExpanded: boolean }[] = [];
    let currentRow: T[] = [];

    for (const item of items) {
      const itemId = getItemId(item);
      const isExpanded = itemId === expandedItemId;

      if (isExpanded) {
        // 現在の行を先にプッシュ
        if (currentRow.length > 0) {
          result.push({ items: currentRow, isExpanded: false });
          currentRow = [];
        }
        // 展開アイテムは単独の行
        result.push({ items: [item], isExpanded: true });
      } else {
        currentRow.push(item);
        // 列数に達したら行を確定
        if (currentRow.length >= columnCount) {
          result.push({ items: currentRow, isExpanded: false });
          currentRow = [];
        }
      }
    }

    // 残りのアイテムを最後の行に
    if (currentRow.length > 0) {
      result.push({ items: currentRow, isExpanded: false });
    }

    return result;
  }, [items, getItemId, expandedItemId, columnCount]);

  // 行の高さを推定する関数
  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return estimatedRowHeight;
      return row.isExpanded ? estimatedExpandedRowHeight : estimatedRowHeight;
    },
    [rows, estimatedRowHeight, estimatedExpandedRowHeight]
  );

  // スクロールコンテナが利用可能かチェック
  const [scrollContainerReady, setScrollContainerReady] = useState(false);

  useEffect(() => {
    // マウント後にスクロールコンテナの存在をチェック
    setScrollContainerReady(scrollContainerRef.current !== null);
  }, [scrollContainerRef]);

  // TanStack Virtual の virtualizer
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan,
    gap: rowGap, // 行間のギャップを設定
    // 行の高さが変わったときに再計算
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return `row-${index}`;
      // 展開状態と含まれるアイテムIDをキーに
      const itemIds = row.items.map(getItemId).join("-");
      return `row-${index}-${row.isExpanded ? "expanded" : "normal"}-${itemIds}`;
    },
  });

  // 仮想化された行の情報を構築
  // スクロールコンテナが利用できない場合（テスト環境など）は全行をフォールバック表示
  const virtualItems = virtualizer.getVirtualItems();
  const shouldFallback = !scrollContainerReady || virtualItems.length === 0;

  const virtualRows: VirtualRow<T>[] = shouldFallback
    ? rows.map((row, index) => ({
        index,
        start: index * (estimatedRowHeight + rowGap),
        size: row.isExpanded ? estimatedExpandedRowHeight : estimatedRowHeight,
        items: row.items,
        isExpanded: row.isExpanded,
      }))
    : virtualItems.map((virtualItem) => {
        const row = rows[virtualItem.index];
        return {
          index: virtualItem.index,
          start: virtualItem.start,
          size: virtualItem.size,
          items: row?.items ?? [],
          isExpanded: row?.isExpanded ?? false,
        };
      });

  // 全体の高さを計算
  const totalSize = shouldFallback
    ? rows.reduce(
        (sum, row) =>
          sum + (row.isExpanded ? estimatedExpandedRowHeight : estimatedRowHeight) + rowGap,
        -rowGap // 最後の行のギャップを引く
      )
    : virtualizer.getTotalSize();

  return {
    virtualRows,
    totalSize: Math.max(totalSize, 0),
    columnCount,
    itemWidth,
    measureElement: virtualizer.measureElement,
  };
};
