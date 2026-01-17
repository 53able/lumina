/**
 * 型安全なAPIクライアント
 *
 * Zodスキーマで検証することで型安全性を確保。
 * Hono RPCクライアントは OpenAPIHono の .openapi() と完全互換ではないため、
 * fetchラッパーで代替。
 */

import {
  type PaperSummary,
  PaperSummarySchema,
  type SearchRequest,
  type SearchResponse,
  SearchResponseSchema,
  SyncRequestSchema,
  type SyncResponse,
  SyncResponseSchema,
} from "@/shared/schemas";

/**
 * Basic認証のデフォルト認証情報
 */
const DEFAULT_CREDENTIALS = btoa("admin:admin");

/**
 * APIリクエストのオプション
 */
interface ApiOptions {
  /** OpenAI APIキー（オプション） */
  apiKey?: string;
}

/**
 * 共通ヘッダーを生成する
 */
const createHeaders = (options?: ApiOptions): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Basic ${DEFAULT_CREDENTIALS}`,
  };

  if (options?.apiKey) {
    headers["X-OpenAI-API-Key"] = options.apiKey;
  }

  return headers;
};

/**
 * 検索API
 *
 * クエリをAIで拡張し、検索用Embeddingを生成する。
 *
 * @param request 検索リクエスト
 * @param options APIオプション
 * @returns 検索レスポンス（Zod検証済み）
 * @throws Error APIエラー時
 */
export const searchApi = async (
  request: SearchRequest,
  options?: ApiOptions
): Promise<SearchResponse> => {
  const response = await fetch("/api/v1/search", {
    method: "POST",
    headers: createHeaders(options),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error ?? "検索に失敗しました");
  }

  const data: unknown = await response.json();
  return SearchResponseSchema.parse(data);
};

/**
 * 同期APIの入力型（デフォルト値を持つフィールドはオプショナル）
 */
type SyncApiInput = {
  categories: string[];
  period?: "7" | "30" | "90" | "180" | "365";
  maxResults?: number;
  /** 開始位置（ページング用） */
  start?: number;
};

/**
 * 同期API
 *
 * arXiv論文を取得し、Embeddingを生成する。
 *
 * @param request 同期リクエスト
 * @param options APIオプション
 * @returns 同期レスポンス（Zod検証済み）
 * @throws Error APIエラー時
 */
export const syncApi = async (
  request: SyncApiInput,
  options?: ApiOptions
): Promise<SyncResponse> => {
  // デフォルト値を適用してバリデーション
  const validatedRequest = SyncRequestSchema.parse(request);

  const response = await fetch("/api/v1/sync", {
    method: "POST",
    headers: createHeaders(options),
    body: JSON.stringify(validatedRequest),
  });

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }

  const data: unknown = await response.json();
  return SyncResponseSchema.parse(data);
};

/**
 * 生成対象の種類
 * - summary: 要約のみ
 * - explanation: 説明文のみ（既存の要約がある場合に使用）
 * - both: 要約と説明文の両方
 */
export type GenerateTarget = "summary" | "explanation" | "both";

/**
 * 要約APIの入力型
 */
type SummaryApiInput = {
  language: "ja" | "en";
  abstract?: string;
  /** 生成対象（デフォルト: summary） */
  generateTarget?: GenerateTarget;
};

/**
 * 要約API
 *
 * 論文のアブストラクトを要約し、キーポイントを抽出する。
 *
 * @param paperId 論文ID
 * @param request 要約リクエスト
 * @param options APIオプション
 * @returns 要約レスポンス（Zod検証済み）
 * @throws Error APIエラー時
 */
export const summaryApi = async (
  paperId: string,
  request: SummaryApiInput,
  options?: ApiOptions
): Promise<PaperSummary> => {
  const response = await fetch(`/api/v1/summary/${encodeURIComponent(paperId)}`, {
    method: "POST",
    headers: createHeaders(options),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error ?? "要約生成に失敗しました");
  }

  const data: unknown = await response.json();
  return PaperSummarySchema.parse(data);
};
