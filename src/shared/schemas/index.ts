/**
 * 共有スキーマのエクスポート
 * フロントエンド・バックエンド両方から参照される型の単一ソース
 */

// Category
export {
  type Category,
  type CategoryListResponse,
  CategoryListResponseSchema,
  CategorySchema,
} from "./category.js";

// Embedding
export {
  EMBEDDING_BATCH_MAX_SIZE,
  EMBEDDING_DIMENSION,
  type EmbeddingBatchRequest,
  EmbeddingBatchRequestSchema,
  type EmbeddingBatchResponse,
  EmbeddingBatchResponseSchema,
  type EmbeddingRequest,
  EmbeddingRequestSchema,
  type EmbeddingResponse,
  EmbeddingResponseSchema,
} from "./embedding.js";

// Interaction
export {
  type CreateInteraction,
  CreateInteractionSchema,
  type InteractionType,
  InteractionTypeSchema,
  type UserInteraction,
  UserInteractionSchema,
} from "./interaction.js";
// Paper
export {
  type Paper,
  PaperSchema,
  type PaperSummary,
  PaperSummarySchema,
} from "./paper.js";
// Search
export {
  type ExpandedQuery,
  ExpandedQuerySchema,
  type SearchHistory,
  SearchHistorySchema,
  type SearchRequest,
  SearchRequestSchema,
  type SearchResponse,
  SearchResponseSchema,
} from "./search.js";

// Sync
export {
  type SyncPeriod,
  SyncPeriodSchema,
  type SyncRequest,
  SyncRequestSchema,
  type SyncResponse,
  SyncResponseSchema,
} from "./sync.js";
