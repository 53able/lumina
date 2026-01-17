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
