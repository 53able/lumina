import { z } from "zod";

/**
 * 拡張クエリのスキーマ
 */
export const ExpandedQuerySchema = z.object({
  /** 元のクエリ（日本語） */
  original: z.string(),
  /** 英語翻訳 */
  english: z.string(),
  /** 同義語・関連語リスト */
  synonyms: z.array(z.string()),
  /** 検索用統合テキスト */
  searchText: z.string(),
});

export type ExpandedQuery = z.infer<typeof ExpandedQuerySchema>;

/**
 * 検索履歴のスキーマ
 */
export const SearchHistorySchema = z.object({
  /** ID */
  id: z.string().uuid(),
  /** 元のクエリ */
  originalQuery: z.string(),
  /** 拡張結果 */
  expandedQuery: ExpandedQuerySchema,
  /** クエリベクトル */
  queryEmbedding: z.array(z.number()).optional(),
  /** 検索結果件数 */
  resultCount: z.number().int().nonnegative(),
  /** 作成日時 */
  createdAt: z.coerce.date(),
});

export type SearchHistory = z.infer<typeof SearchHistorySchema>;

/** 検索クエリの最大長（SearchRequestSchema の query.max と一致） */
export const MAX_QUERY_LENGTH = 500;

/**
 * 検索リクエストのスキーマ
 */
export const SearchRequestSchema = z.object({
  /** 検索クエリ */
  query: z.string().min(1).max(MAX_QUERY_LENGTH),
  /** 取得件数 */
  limit: z.number().int().min(1).max(100).default(20),
  /** カテゴリフィルタ */
  categories: z.array(z.string()).optional(),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

/**
 * 検索レスポンスのスキーマ
 */
export const SearchResponseSchema = z.object({
  /** 検索結果（クライアント側で計算する場合は空配列） */
  results: z.array(
    z.object({
      /** 論文ID */
      paperId: z.string(),
      /** 類似度スコア */
      score: z.number(),
    })
  ),
  /** 拡張クエリ */
  expandedQuery: ExpandedQuerySchema,
  /** クエリのEmbeddingベクトル（クライアント側でのローカル検索用） */
  queryEmbedding: z.array(z.number()).optional(),
  /** 検索にかかった時間（ms） */
  took: z.number(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
