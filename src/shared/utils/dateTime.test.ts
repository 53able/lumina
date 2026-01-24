import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDate,
  measureTime,
  normalizeDate,
  now,
  parseISO,
  timestamp,
  toISOString,
} from "./dateTime.js";

describe("dateTime utilities", () => {
  describe("now", () => {
    it("現在時刻の Date オブジェクトを返す", () => {
      const before = Date.now();
      const result = now();
      const after = Date.now();

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe("timestamp", () => {
    it("現在時刻のタイムスタンプ（ミリ秒）を返す", () => {
      const before = Date.now();
      const result = timestamp();
      const after = Date.now();

      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe("measureTime", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("開始時刻からの経過時間を計測する", () => {
      const startTime = timestamp();
      vi.advanceTimersByTime(100);
      const elapsed = measureTime(startTime);

      expect(elapsed).toBe(100);
    });

    it("経過時間が0の場合も正しく計測する", () => {
      const startTime = timestamp();
      const elapsed = measureTime(startTime);

      expect(elapsed).toBe(0);
    });
  });

  describe("toISOString", () => {
    it("Date を ISO 8601 文字列に変換する", () => {
      const date = new Date("2026-01-18T12:30:00.000Z");
      const result = toISOString(date);

      // formatISO はタイムゾーン付きで返す（環境依存）
      // 少なくとも日付部分は一致することを確認
      expect(result).toContain("2026-01-18");
    });
  });

  describe("parseISO", () => {
    it("ISO 8601 文字列を Date オブジェクトに変換する", () => {
      const isoString = "2026-01-18T12:30:00.000Z";
      const result = parseISO(isoString);

      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(isoString);
    });
  });

  describe("isDate", () => {
    it("Date オブジェクトの場合 true を返す", () => {
      expect(isDate(new Date())).toBe(true);
    });

    it("文字列の場合 false を返す", () => {
      expect(isDate("2026-01-18")).toBe(false);
    });

    it("数値の場合 false を返す", () => {
      expect(isDate(1737187200000)).toBe(false);
    });

    it("null の場合 false を返す", () => {
      expect(isDate(null)).toBe(false);
    });

    it("undefined の場合 false を返す", () => {
      expect(isDate(undefined)).toBe(false);
    });
  });

  describe("normalizeDate", () => {
    it("Date オブジェクトはそのまま返す", () => {
      const date = new Date("2026-01-18T12:30:00.000Z");
      const result = normalizeDate(date);

      expect(result).toBe(date);
    });

    it("ISO 文字列を Date オブジェクトに変換する", () => {
      const isoString = "2026-01-18T12:30:00.000Z";
      const result = normalizeDate(isoString);

      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(isoString);
    });
  });
});
