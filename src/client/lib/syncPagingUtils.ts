/**
 * 同期ページング用ユーティリティ（ギャップ補填）
 *
 * 取得済み範囲 [start, end) を管理し、次にリクエストすべき start を決定する。
 */

/** 範囲 [start, end) を表すタプル */
export type Range = [number, number];

/**
 * 重複・隣接する範囲をマージし、start でソートして返す。
 *
 * @param ranges - マージ対象の範囲の配列
 * @returns ソート済み・マージ済みの範囲の配列
 */
export const mergeRanges = (ranges: Range[]): Range[] => {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i];
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], end)];
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

/**
 * 範囲リストと totalResults から、次にリクエストすべき start を返す。
 * ギャップがあればその先頭、なければ先頭の連続の次（max(end)）を返す。
 *
 * @param ranges - 取得済み範囲の配列 [start, end)
 * @param totalResults - 同期期間・カテゴリで絞った総件数
 * @param batchSize - 1リクエストあたりの取得件数
 * @returns 次にリクエストすべき start
 */
export const getNextStartToRequest = (
  ranges: Range[],
  totalResults: number,
  _batchSize: number
): number => {
  if (totalResults <= 0) return 0;

  const merged = mergeRanges(ranges);
  if (merged.length === 0) return 0;

  let pos = 0;
  for (const [start, end] of merged) {
    if (pos < start) return pos;
    pos = end;
  }
  if (pos < totalResults) return pos;
  return pos;
};
