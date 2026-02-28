import { z } from "zod";

/**
 * 日別件数 1 件分のスキーマ
 *
 * 論文キャッシュの publishedAt を日単位で集計した結果の要素。
 */
export const DailyCountEntrySchema = z.object({
  /** 日付（YYYY-MM-DD） */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** その日の論文数 */
  count: z.number().int().nonnegative(),
});

export type DailyCountEntry = z.infer<typeof DailyCountEntrySchema>;
