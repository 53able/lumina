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
} from "./category";

// Embedding
export {
  EMBEDDING_DIMENSION,
  type EmbeddingRequest,
  EmbeddingRequestSchema,
  type EmbeddingResponse,
  EmbeddingResponseSchema,
} from "./embedding";

// Interaction
export {
  type CreateInteraction,
  CreateInteractionSchema,
  type InteractionType,
  InteractionTypeSchema,
  type UserInteraction,
  UserInteractionSchema,
} from "./interaction";
// Paper
export {
  type Paper,
  PaperSchema,
  type PaperSummary,
  PaperSummarySchema,
} from "./paper";
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
} from "./search";

// Sync
export {
  type SyncPeriod,
  SyncPeriodSchema,
  type SyncRequest,
  SyncRequestSchema,
  type SyncResponse,
  SyncResponseSchema,
} from "./sync";
