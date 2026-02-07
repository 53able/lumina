import { z } from "zod";
import { PaperSchema } from "./paper";

/**
 * 同期期間（日数）
 */
export const SyncPeriodSchema = z.enum(["1", "3", "7", "30", "90", "180", "365"]);

export type SyncPeriod = z.infer<typeof SyncPeriodSchema>;

/**
 * 同期リクエストのスキーマ
 */
export const SyncRequestSchema = z.object({
  /** 対象カテゴリ */
  categories: z.array(z.string()).min(1),
  /** 同期期間（日数） */
  period: SyncPeriodSchema.default("1"),
  /** 最大取得件数 */
  maxResults: z.number().int().min(1).max(200).default(100),
  /** 開始位置（ページング用） */
  start: z.number().int().nonnegative().default(0),
});

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

/**
 * 同期レスポンスのスキーマ
 */
export const SyncResponseSchema = z.object({
  /** 取得した論文データ（Embedding付き） */
  papers: z.array(PaperSchema),
  /** 取得した論文数 */
  fetchedCount: z.number().int().nonnegative(),
  /** 全件数（arXiv上の該当論文総数） */
  totalResults: z.number().int().nonnegative(),
  /** 同期にかかった時間（ms） */
  took: z.number(),
});

export type SyncResponse = z.infer<typeof SyncResponseSchema>;
