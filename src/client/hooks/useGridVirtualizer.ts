import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useMemo, useState } from "react";

/** グリッド仮想化の設定オプション */
interface UseGridVirtualizerOptions<T> {
  /** スクロールコンテナへの参照（幅の取得・ResizeObserver の監視対象） */
  scrollContainerRef: RefObject<HTMLElement | null>;
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
 *   items: papers,
 *   getItemId: (paper) => paper.id,
 *   expandedItemId: selectedPaperId,
 * });
 * ```
 */
export const useGridVirtualizer = <T>({
  scrollContainerRef,
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
  // コンテナ幅の状態（列数計算用。スクロールコンテナの表示幅を監視）
  const [containerWidth, setContainerWidth] = useState(0);

  // ResizeObserverでスクロールコンテナ幅を監視（幅はスクロールコンテナ基準で確実に取得）
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          const width = scrollContainerRef.current.clientWidth;
          if (width > 0) setContainerWidth(width);
        }
      }, 0);
      return () => clearTimeout(timer);
    }

    const initialWidth = element.clientWidth;
    if (initialWidth > 0) setContainerWidth(initialWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  // 列数とアイテム幅を計算
  // containerWidthが0のときは scrollContainerRef から直接読む（初回レンダや検索0件→一覧復帰直後）
  const { columnCount, itemWidth } = useMemo(() => {
    let effectiveWidth = containerWidth;
    if (effectiveWidth === 0 && scrollContainerRef.current) {
      effectiveWidth = scrollContainerRef.current.clientWidth;
    }
    if (effectiveWidth === 0) {
      effectiveWidth = 400;
    }

    // 小数点以下を切り捨てて精度問題を回避
    effectiveWidth = Math.floor(effectiveWidth);

    // auto-fit 相当: コンテナ幅 / (最小幅 + ギャップ) で列数を計算
    // (containerWidth + columnGap) / (minItemWidth + columnGap) で正確に計算
    const cols = Math.max(1, Math.floor((effectiveWidth + columnGap) / (minItemWidth + columnGap)));

    // 実際のアイテム幅を計算（ギャップを考慮して均等分割）
    // Math.floor で切り捨てて、オーバーフローを防止
    const width = Math.floor((effectiveWidth - columnGap * (cols - 1)) / cols);
    // 1列のときはコンテナ幅を超えないよう width をそのまま使う（minItemWidth で clamp しない）
    const itemWidth = cols === 1 ? width : Math.max(width, minItemWidth);

    return { columnCount: cols, itemWidth };
  }, [containerWidth, minItemWidth, columnGap, scrollContainerRef]);

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

  // 行のキーを事前計算してキャッシュ（getItemKeyの計算負荷を削減）
  const rowKeys = useMemo(() => {
    return rows.map((row, index) => {
      const itemIds = row.items.map(getItemId).join("-");
      return `row-${index}-${row.isExpanded ? "expanded" : "normal"}-${itemIds}`;
    });
  }, [rows, getItemId]);

  // スクロールコンテナが利用可能かチェック
  // SSR時はfalse、クライアント側でマウント後にtrueになる
  const [scrollContainerReady, setScrollContainerReady] = useState(false);

  useEffect(() => {
    // マウント後にスクロールコンテナの存在をチェック
    if (scrollContainerRef.current !== null && !scrollContainerReady) {
      setScrollContainerReady(true);
    }
    // refオブジェクト自体は安定しているため、scrollContainerReadyの変更時のみ再実行される
  }, [scrollContainerRef, scrollContainerReady]); // scrollContainerReadyを依存配列に追加

  // TanStack Virtual の virtualizer
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan,
    gap: rowGap, // 行間のギャップを設定
    // キャッシュされたキーを返す
    getItemKey: (index: number) => rowKeys[index] ?? `row-${index}`,
  });

  // 仮想化された行の情報を構築
  // スクロールコンテナが利用できない場合（SSR時など）は最初の数行のみ表示
  const virtualItems = virtualizer.getVirtualItems();
  const shouldFallback = !scrollContainerReady || virtualItems.length === 0;

  const virtualRows: VirtualRow<T>[] = shouldFallback
    ? (() => {
        // 展開行を見つける
        const expandedRowIndex = rows.findIndex((row) => row.isExpanded);
        // 最初の10行、または展開行が含まれる範囲まで
        const endIndex = expandedRowIndex >= 0 ? Math.max(expandedRowIndex + 1, 10) : 10;

        // 各行の位置を累積計算（展開行の高さを考慮）
        let currentStart = 0;
        return rows.slice(0, endIndex).map((row, index) => {
          const size = row.isExpanded ? estimatedExpandedRowHeight : estimatedRowHeight;
          const result = {
            index,
            start: currentStart,
            size,
            items: row.items,
            isExpanded: row.isExpanded,
          };
          currentStart += size + rowGap;
          return result;
        });
      })()
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
    ? virtualRows.reduce(
        (sum, row) => sum + row.size + rowGap,
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
