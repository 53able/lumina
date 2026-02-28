import { format, startOfDay } from "date-fns";
import type { DailyCountEntry, Paper } from "../schemas/index.js";

/**
 * 論文の公開日（publishedAt）を日単位で集計する
 *
 * 参照透過な純粋関数。日付は YYYY-MM-DD に正規化し、時系列昇順で返す。
 *
 * @param papers - 論文の配列（paperStore.papers など）
 * @returns 日付ごとの件数配列（日付昇順）
 */
export const aggregatePapersByDay = (papers: Paper[]): DailyCountEntry[] => {
  const countByDate = new Map<string, number>();

  for (const paper of papers) {
    const day = startOfDay(paper.publishedAt);
    const key = format(day, "yyyy-MM-dd");
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  }

  const entries = Array.from(countByDate.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return entries;
};

/**
 * 日別件数配列から件数（count）の中央値を求める
 *
 * 「少ない日」の閾値として利用する。参照透過な純粋関数。
 * 偶数件のときは中央2つの平均（小数点はそのまま）を返す。
 *
 * @param entries - 日別件数配列
 * @returns 中央値。空配列のときは 0
 */
export const getMedianCount = (entries: DailyCountEntry[]): number => {
  if (entries.length === 0) return 0;
  const counts = [...entries].map((e) => e.count).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  if (counts.length % 2 !== 0) return counts[mid] ?? 0;
  return ((counts[mid - 1] ?? 0) + (counts[mid] ?? 0)) / 2;
};

/**
 * 閾値以下の件数だった日だけを、元の日付順で返す
 *
 * 「少ない日」の一覧表示用。参照透過な純粋関数。
 *
 * @param entries - 日別件数配列（日付昇順想定）
 * @param threshold - この値以下を「少ない」とする
 * @returns count <= threshold のエントリのみ（日付順のまま）
 */
export const getLowDayEntries = (
  entries: DailyCountEntry[],
  threshold: number
): DailyCountEntry[] => entries.filter((e) => e.count <= threshold);
