import { z } from "zod";

/**
 * Embedding次元数
 */
export const EMBEDDING_DIMENSION = 1536;

/**
 * Embeddingリクエストのスキーマ
 */
export const EmbeddingRequestSchema = z.object({
  /** Embedding対象のテキスト */
  text: z.string().min(1).max(8000),
});

export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;

/**
 * Embeddingレスポンスのスキーマ
 */
export const EmbeddingResponseSchema = z.object({
  /** Embeddingベクトル（1536次元） */
  embedding: z.array(z.number()).length(EMBEDDING_DIMENSION),
  /** 使用したモデル */
  model: z.string(),
  /** 処理にかかった時間（ms） */
  took: z.number(),
});

export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

/** バッチ Embedding リクエストの最大件数（レート・トークン上限を考慮） */
export const EMBEDDING_BATCH_MAX_SIZE = 20;

/**
 * バッチ Embedding リクエストのスキーマ
 */
export const EmbeddingBatchRequestSchema = z.object({
  /** Embedding 対象のテキスト配列（1〜EMBEDDING_BATCH_MAX_SIZE 件） */
  texts: z.array(z.string().min(1).max(8000)).min(1).max(EMBEDDING_BATCH_MAX_SIZE),
});

export type EmbeddingBatchRequest = z.infer<typeof EmbeddingBatchRequestSchema>;

/**
 * バッチ Embedding レスポンスのスキーマ
 */
export const EmbeddingBatchResponseSchema = z.object({
  /** 各テキストに対応する Embedding ベクトル（入力順） */
  embeddings: z.array(z.array(z.number()).length(EMBEDDING_DIMENSION)),
  /** 使用したモデル */
  model: z.string(),
  /** 処理にかかった時間（ms） */
  took: z.number(),
});

export type EmbeddingBatchResponse = z.infer<typeof EmbeddingBatchResponseSchema>;
