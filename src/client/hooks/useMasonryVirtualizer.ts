import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Masonry layout entry for a normal card or a full-width expanded interrupt. */
export type MasonryLayoutEntry<T> =
  | {
      kind: "card";
      item: T;
      index: number;
      columnIndex: number;
      top: number;
      left: number;
      width: number;
      height: number;
    }
  | {
      kind: "expanded";
      item: T;
      index: number;
      top: number;
      left: 0;
      width: number;
      height: number;
    };

interface ComputeMasonryLayoutOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  expandedItemId: string | null;
  columnCount: number;
  itemWidth: number;
  fullWidth: number;
  rowGap: number;
  columnGap: number;
  estimatedExpandedHeight: number;
  expandedHeight?: number;
  estimateItemHeight: (item: T, itemWidth: number) => number;
}

interface MasonryLayoutResult<T> {
  entries: MasonryLayoutEntry<T>[];
  totalSize: number;
}

export interface UseMasonryVirtualizerOptions<T> {
  scrollContainerRef: RefObject<HTMLElement | null>;
  items: T[];
  getItemId: (item: T) => string;
  expandedItemId: string | null;
  minItemWidth?: number;
  rowGap?: number;
  columnGap?: number;
  estimatedRowHeight?: number;
  estimatedExpandedHeight?: number;
  overscan?: number;
  estimateItemHeight: (item: T, itemWidth: number) => number;
}

interface UseMasonryVirtualizerResult<T> {
  virtualEntries: MasonryLayoutEntry<T>[];
  totalSize: number;
  columnCount: number;
  itemWidth: number;
  measureExpandedElement: (element: HTMLElement | null) => void;
}

const getColumnMetrics = (
  containerWidth: number,
  minItemWidth: number,
  columnGap: number
): { columnCount: number; itemWidth: number; fullWidth: number } => {
  const effectiveWidth = Math.max(1, Math.floor(containerWidth || 400));
  const columnCount = Math.max(
    1,
    Math.floor((effectiveWidth + columnGap) / (minItemWidth + columnGap))
  );
  const width = Math.floor((effectiveWidth - columnGap * (columnCount - 1)) / columnCount);
  const itemWidth = columnCount === 1 ? width : Math.max(width, minItemWidth);
  const fullWidth = itemWidth * columnCount + columnGap * (columnCount - 1);

  return { columnCount, itemWidth, fullWidth };
};

export const computeMasonryLayout = <T>({
  items,
  getItemId,
  expandedItemId,
  columnCount,
  itemWidth,
  fullWidth,
  rowGap,
  columnGap,
  estimatedExpandedHeight,
  expandedHeight,
  estimateItemHeight,
}: ComputeMasonryLayoutOptions<T>): MasonryLayoutResult<T> => {
  const entries: MasonryLayoutEntry<T>[] = [];
  const columnBottoms = Array.from({ length: Math.max(1, columnCount) }, () => 0);
  let hasEntries = false;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;

    if (expandedItemId !== null && getItemId(item) === expandedItemId) {
      const rawTop = Math.max(...columnBottoms);
      const top = hasEntries ? rawTop : 0;
      const height = expandedHeight ?? estimatedExpandedHeight;
      entries.push({ kind: "expanded", item, index, top, left: 0, width: fullWidth, height });
      const bottom = top + height + rowGap;
      columnBottoms.fill(bottom);
      hasEntries = true;
      continue;
    }

    let targetColumn = 0;
    for (let column = 1; column < columnBottoms.length; column += 1) {
      if ((columnBottoms[column] ?? 0) < (columnBottoms[targetColumn] ?? 0)) {
        targetColumn = column;
      }
    }

    const top = columnBottoms[targetColumn] ?? 0;
    const left = targetColumn * (itemWidth + columnGap);
    const height = estimateItemHeight(item, itemWidth);
    entries.push({
      kind: "card",
      item,
      index,
      columnIndex: targetColumn,
      top,
      left,
      width: itemWidth,
      height,
    });
    columnBottoms[targetColumn] = top + height + rowGap;
    hasEntries = true;
  }

  const maxBottom = Math.max(0, ...columnBottoms);
  return { entries, totalSize: hasEntries ? Math.max(0, maxBottom - rowGap) : 0 };
};

const filterVisibleEntries = <T>(
  entries: MasonryLayoutEntry<T>[],
  rangeStart: number,
  rangeEnd: number
): MasonryLayoutEntry<T>[] =>
  entries.filter((entry) => entry.top + entry.height >= rangeStart && entry.top <= rangeEnd);

export const useMasonryVirtualizer = <T>({
  scrollContainerRef,
  items,
  getItemId,
  expandedItemId,
  minItemWidth = 300,
  rowGap = 16,
  columnGap = 16,
  estimatedRowHeight = 200,
  estimatedExpandedHeight = 500,
  overscan = 3,
  estimateItemHeight,
}: UseMasonryVirtualizerOptions<T>): UseMasonryVirtualizerResult<T> => {
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, viewportHeight: 0 });
  const [expandedMeasuredHeight, setExpandedMeasuredHeight] = useState<number | undefined>();
  const expandedObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    const updateMetrics = () => {
      setContainerWidth(element.clientWidth);
      setScrollState({ scrollTop: element.scrollTop, viewportHeight: element.clientHeight });
    };

    updateMetrics();

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(element);
    element.addEventListener("scroll", updateMetrics, { passive: true });

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", updateMetrics);
    };
  }, [scrollContainerRef]);

  useEffect(() => {
    if (expandedItemId === null) {
      setExpandedMeasuredHeight(undefined);
      return;
    }
    setExpandedMeasuredHeight(undefined);
  }, [expandedItemId]);

  useEffect(() => () => expandedObserverRef.current?.disconnect(), []);

  const { columnCount, itemWidth, fullWidth } = useMemo(
    () => getColumnMetrics(containerWidth, minItemWidth, columnGap),
    [containerWidth, minItemWidth, columnGap]
  );

  const { entries, totalSize } = useMemo(
    () =>
      computeMasonryLayout({
        items,
        getItemId,
        expandedItemId,
        columnCount,
        itemWidth,
        fullWidth,
        rowGap,
        columnGap,
        estimatedExpandedHeight,
        expandedHeight: expandedMeasuredHeight,
        estimateItemHeight,
      }),
    [
      items,
      getItemId,
      expandedItemId,
      columnCount,
      itemWidth,
      fullWidth,
      rowGap,
      columnGap,
      estimatedExpandedHeight,
      expandedMeasuredHeight,
      estimateItemHeight,
    ]
  );

  const measureExpandedElement = useCallback((element: HTMLElement | null) => {
    expandedObserverRef.current?.disconnect();
    expandedObserverRef.current = null;
    if (!element) return;

    const update = () => {
      const measured = element.getBoundingClientRect().height || element.offsetHeight;
      if (measured > 0) setExpandedMeasuredHeight(measured);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    expandedObserverRef.current = observer;
  }, []);

  const overscanPx = overscan * estimatedRowHeight;
  const shouldFallback = scrollState.viewportHeight <= 0;
  const virtualEntries = shouldFallback
    ? entries.slice(0, 20)
    : filterVisibleEntries(
        entries,
        Math.max(0, scrollState.scrollTop - overscanPx),
        scrollState.scrollTop + scrollState.viewportHeight + overscanPx
      );

  return {
    virtualEntries,
    totalSize,
    columnCount,
    itemWidth,
    measureExpandedElement,
  };
};
