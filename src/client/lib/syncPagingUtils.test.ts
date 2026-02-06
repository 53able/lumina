/**
 * syncPagingUtils の単体テスト（ギャップ補填用）
 */
import { describe, expect, it } from "vitest";
import { getGapSize, getNextStartToRequest, mergeRanges } from "./syncPagingUtils";

describe("mergeRanges", () => {
  it("隣接する範囲 [0,50] と [50,100] をマージして [0,100] を返す", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [50, 100],
    ];
    expect(mergeRanges(ranges)).toEqual([[0, 100]]);
  });

  it("ソートされていない範囲 [100,150] と [0,50] を start でソートして返す", () => {
    const ranges: [number, number][] = [
      [100, 150],
      [0, 50],
    ];
    expect(mergeRanges(ranges)).toEqual([
      [0, 50],
      [100, 150],
    ]);
  });

  it("重複する範囲 [0,50] と [25,75] をマージして [0,75] を返す", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [25, 75],
    ];
    expect(mergeRanges(ranges)).toEqual([[0, 75]]);
  });
});

describe("getNextStartToRequest", () => {
  const BATCH_SIZE = 50;

  it("範囲が空で totalResults=100 のとき 0 を返す", () => {
    const ranges: [number, number][] = [];
    expect(getNextStartToRequest(ranges, 100, BATCH_SIZE)).toBe(0);
  });

  it("[[0,50]] で totalResults=100 のとき 50 を返す（ギャップなし・先頭の次）", () => {
    const ranges: [number, number][] = [[0, 50]];
    expect(getNextStartToRequest(ranges, 100, BATCH_SIZE)).toBe(50);
  });

  it("[[0,50], [100,150]] で totalResults=200 のときギャップ 50-100 の先頭 50 を返す", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getNextStartToRequest(ranges, 200, BATCH_SIZE)).toBe(50);
  });

  it("[[0,50], [50,100]] で totalResults=200 のときマージ後 100 を返す（隣接）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [50, 100],
    ];
    expect(getNextStartToRequest(ranges, 200, BATCH_SIZE)).toBe(100);
  });

  it("[[0,50], [100,150]] で totalResults=120 のときギャップの先頭 50 を返す", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getNextStartToRequest(ranges, 120, BATCH_SIZE)).toBe(50);
  });
});

describe("getGapSize", () => {
  it("範囲が空で totalResults=100, currentStart=0 のとき 100 を返す", () => {
    const ranges: [number, number][] = [];
    expect(getGapSize(ranges, 100, 0)).toBe(100);
  });

  it("[[0,50]] で totalResults=100, currentStart=50 のとき 50 を返す（ギャップなし・連続取得）", () => {
    const ranges: [number, number][] = [[0, 50]];
    expect(getGapSize(ranges, 100, 50)).toBe(50);
  });

  it("[[0,50], [100,150]] で totalResults=200, currentStart=50 のときギャップサイズ 50 を返す", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getGapSize(ranges, 200, 50)).toBe(50);
  });

  it("[[0,50], [100,150]] で totalResults=200, currentStart=30 のときギャップサイズ 50 を返す（取得済み範囲内）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getGapSize(ranges, 200, 30)).toBe(50);
  });

  it("[[0,50], [100,150]] で totalResults=120, currentStart=50 のときギャップサイズ 50 を返す（totalResults で制限）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getGapSize(ranges, 120, 50)).toBe(50);
  });

  it("[[0,50], [50,100]] で totalResults=200, currentStart=50 のとき 100 を返す（隣接・連続取得）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [50, 100],
    ];
    expect(getGapSize(ranges, 200, 50)).toBe(100);
  });

  it("[[0,50], [100,150]] で totalResults=200, currentStart=150 のとき 50 を返す（全ての取得済み範囲より後ろ）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getGapSize(ranges, 200, 150)).toBe(50);
  });

  it("[[0,50], [100,150]] で totalResults=120, currentStart=150 のとき 0 を返す（totalResults を超える）", () => {
    const ranges: [number, number][] = [
      [0, 50],
      [100, 150],
    ];
    expect(getGapSize(ranges, 120, 150)).toBe(0);
  });
});
