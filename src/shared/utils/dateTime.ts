/**
 * 日付・時刻ユーティリティ
 *
 * Date オブジェクトの生成を局所化し、テスタビリティと一貫性を向上させる。
 * このモジュール外では `new Date()` や `Date.now()` を直接使用しないこと。
 *
 * @example
 * ```ts
 * import { now, timestamp, toISOString, measureTime } from './dateTime';
 *
 * // 現在時刻の取得
 * const currentDate = now();
 *
 * // パフォーマンス計測
 * const startTime = timestamp();
 * await someOperation();
 * const elapsed = measureTime(startTime);
 * console.log(`処理時間: ${elapsed}ms`);
 *
 * // ISO文字列の取得
 * const isoString = toISOString(now());
 * ```
 *
 * @module
 */

import { parseISO as dateFnsParseISO, formatISO } from "date-fns";

/**
 * 現在時刻の Date オブジェクトを取得する
 *
 * @returns 現在時刻の Date オブジェクト
 */
export const now = (): Date => new Date();

/**
 * 現在時刻のタイムスタンプ（ミリ秒）を取得する
 *
 * パフォーマンス計測などに使用。
 *
 * @returns UNIXエポックからのミリ秒
 */
export const timestamp = (): number => Date.now();

/**
 * 経過時間を計測する
 *
 * @param startTime - 計測開始時のタイムスタンプ（timestamp() の戻り値）
 * @returns 経過時間（ミリ秒）
 *
 * @example
 * ```ts
 * const startTime = timestamp();
 * await someOperation();
 * const elapsed = measureTime(startTime);
 * ```
 */
export const measureTime = (startTime: number): number => timestamp() - startTime;

/**
 * Date オブジェクトを ISO 8601 文字列に変換する
 *
 * @param date - 変換対象の Date オブジェクト
 * @returns ISO 8601 形式の文字列（例: "2026-01-18T12:30:00+09:00"）
 */
export const toISOString = (date: Date): string => formatISO(date);

/**
 * ISO 8601 文字列を Date オブジェクトに変換する
 *
 * date-fns の parseISO をそのまま re-export。
 *
 * @param isoString - ISO 8601 形式の文字列
 * @returns パースされた Date オブジェクト
 */
export const parseISO = dateFnsParseISO;

/**
 * 値が Date オブジェクトかどうかを判定する
 *
 * @param value - 判定対象の値
 * @returns Date オブジェクトの場合 true
 */
export const isDate = (value: unknown): value is Date => value instanceof Date;

/**
 * Date または ISO 文字列を Date オブジェクトに正規化する
 *
 * API レスポンスの日付フィールドは、型定義上は Date だが
 * 実際の JSON では ISO 文字列として返ってくる場合がある。
 * この関数でどちらのケースも安全に Date に変換できる。
 *
 * @param value - Date オブジェクトまたは ISO 8601 文字列
 * @returns 正規化された Date オブジェクト
 *
 * @example
 * ```ts
 * // どちらも Date オブジェクトになる
 * normalizeDate(new Date());           // → Date
 * normalizeDate("2026-01-18T12:00:00Z"); // → Date
 * ```
 */
export const normalizeDate = (value: Date | string): Date =>
  isDate(value) ? value : parseISO(value);
