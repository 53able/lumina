import { describe, expect, it } from "vitest";
import type { DailyCountEntry } from "../schemas/index.js";
import { getLowDayEntries, getMedianCount } from "./paperStats.js";

describe("getMedianCount", () => {
  it("空配列のとき 0 を返す", () => {
    expect(getMedianCount([])).toBe(0);
  });

  it("1件のときその count を返す", () => {
    expect(getMedianCount([{ date: "2024-01-01", count: 5 }])).toBe(5);
  });

  it("奇数件のとき中央の値を返す", () => {
    const entries: DailyCountEntry[] = [
      { date: "2024-01-01", count: 1 },
      { date: "2024-01-02", count: 3 },
      { date: "2024-01-03", count: 5 },
    ];
    expect(getMedianCount(entries)).toBe(3);
  });

  it("偶数件のとき中央2つの平均を返す", () => {
    const entries: DailyCountEntry[] = [
      { date: "2024-01-01", count: 2 },
      { date: "2024-01-02", count: 4 },
      { date: "2024-01-03", count: 6 },
      { date: "2024-01-04", count: 8 },
    ];
    expect(getMedianCount(entries)).toBe(5);
  });

  it("同値が複数ある場合でも中央値を返す", () => {
    const entries: DailyCountEntry[] = [
      { date: "2024-01-01", count: 10 },
      { date: "2024-01-02", count: 10 },
      { date: "2024-01-03", count: 10 },
    ];
    expect(getMedianCount(entries)).toBe(10);
  });
});

describe("getLowDayEntries", () => {
  it("閾値以下の日だけを日付順で返す", () => {
    const entries: DailyCountEntry[] = [
      { date: "2024-01-01", count: 10 },
      { date: "2024-01-02", count: 2 },
      { date: "2024-01-03", count: 5 },
      { date: "2024-01-04", count: 1 },
    ];
    expect(getLowDayEntries(entries, 5)).toEqual([
      { date: "2024-01-02", count: 2 },
      { date: "2024-01-03", count: 5 },
      { date: "2024-01-04", count: 1 },
    ]);
  });

  it("該当なしのとき空配列を返す", () => {
    const entries: DailyCountEntry[] = [
      { date: "2024-01-01", count: 10 },
      { date: "2024-01-02", count: 8 },
    ];
    expect(getLowDayEntries(entries, 5)).toEqual([]);
  });
});
