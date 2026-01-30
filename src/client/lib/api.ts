/**
 * 型安全な Hono RPC クライアント
 *
 * hono/client を使用してバックエンドと型安全に通信する。
 * app.ts がメソッドチェーン形式で構築されているため、
 * すべてのルートの入出力型が自動的に推論される。
 */

import { hc } from "hono/client";
import type { AppType } from "@/api/app";
import { useSettingsStore } from "@/client/stores/settingsStore";
import type { SearchRequest } from "@/shared/schemas/index";

/**
 * APIクライアントのベースURL
 * - 開発: Viteプロキシ経由で相対パス
 * - 本番: Vercel同一ドメインで相対パス
 */
const getBaseUrl = () => {
  if (typeof window === "undefined") return "";
  return window.location.origin;
};

/**
 * Hono RPC クライアント
 */
const client = hc<AppType>(getBaseUrl());

/**
 * APIリクエストのオプション
 */
interface ApiOptions {
  /** OpenAI APIキー（オプション） */
  apiKey?: string;
}

/**
 * OpenAI APIキーヘッダーを追加
 */
const withApiKey = (options?: ApiOptions) => {
  if (!options?.apiKey) return {};
  return {
    headers: {
      "X-OpenAI-API-Key": options.apiKey,
    },
  };
};

/**
 * settingsStore から復号化された API key を取得する
 *
 * @description
 * API 呼び出し前にこの関数を使用して平文の API key を取得し、
 * searchApi/syncApi/summaryApi の options に渡す。
 *
 * @returns 平文の API key（未設定の場合は undefined）
 *
 * @example
 * ```typescript
 * const apiKey = await getDecryptedApiKey();
 * const result = await searchApi(request, { apiKey });
 * ```
 */
export const getDecryptedApiKey = async (): Promise<string | undefined> => {
  const store = useSettingsStore.getState();
  if (!store.hasApiKey()) {
    return undefined;
  }
  const plainKey = await store.getApiKeyAsync();
  return plainKey || undefined;
};

/**
 * 検索API
 *
 * クエリをAIで拡張し、検索用Embeddingを生成する。
 * Hono RPC により、レスポンス型は自動推論される。
 *
 * @param request 検索リクエスト
 * @param options APIオプション
 * @returns 検索レスポンス（RPC型推論）
 * @throws Error APIエラー時
 */
export const searchApi = async (request: SearchRequest, options?: ApiOptions) => {
  const res = await client.api.v1.search.$post({ json: request }, withApiKey(options));

  if (!res.ok) {
    const error = await res.json();
    throw new Error("error" in error ? error.error : "検索に失敗しました");
  }

  // Hono RPC: res.ok === true の場合、成功レスポンスの型が推論される
  return res.json();
};

/**
 * Embedding API
 *
 * テキストから Embedding ベクトルを生成する。
 *
 * @param request { text: string } 対象テキスト（1〜8000文字）
 * @param options APIオプション
 * @returns embedding 配列（1536次元）
 * @throws Error APIエラー時
 */
export const embeddingApi = async (
  request: { text: string },
  options?: ApiOptions
): Promise<{ embedding: number[] }> => {
  const res = await client.api.v1.embedding.$post({ json: request }, withApiKey(options));

  if (!res.ok) {
    const error = await res.json();
    const message =
      error && typeof error === "object" && "error" in error
        ? String((error as { error: unknown }).error)
        : "Embeddingの取得に失敗しました";
    throw new Error(message);
  }

  return res.json();
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
 * Hono RPC により、レスポンス型は自動推論される。
 *
 * @param request 同期リクエスト
 * @param options APIオプション
 * @returns 同期レスポンス（RPC型推論）
 * @throws Error APIエラー時
 */
export const syncApi = async (request: SyncApiInput, options?: ApiOptions) => {
  const res = await client.api.v1.sync.$post(
    {
      json: {
        categories: request.categories,
        period: request.period ?? "30",
        maxResults: request.maxResults ?? 50,
        start: request.start ?? 0,
      },
    },
    withApiKey(options)
  );

  if (!res.ok) {
    throw new Error(`Sync failed: ${res.status}`);
  }

  // Hono RPC: res.ok === true の場合、成功レスポンスの型が推論される
  return res.json();
};

/**
 * 生成対象の種類
 * - explanation: 説明文のみ（既存の要約がある場合に使用）
 * - both: 要約と説明文の両方
 */
export type GenerateTarget = "explanation" | "both";

/**
 * 要約APIの入力型
 */
type SummaryApiInput = {
  language: "ja" | "en";
  abstract?: string;
  /** 生成対象（デフォルト: both） */
  generateTarget?: GenerateTarget;
};

/**
 * 要約API
 *
 * 論文のアブストラクトを要約し、キーポイントを抽出する。
 * Hono RPC により、レスポンス型は自動推論される。
 *
 * @param paperId 論文ID
 * @param request 要約リクエスト
 * @param options APIオプション
 * @returns 要約レスポンス（RPC型推論）
 * @throws Error APIエラー時
 */
export const summaryApi = async (
  paperId: string,
  request: SummaryApiInput,
  options?: ApiOptions
) => {
  const res = await client.api.v1.summary[":id"].$post(
    {
      param: { id: paperId },
      json: {
        language: request.language,
        abstract: request.abstract,
        generateTarget: request.generateTarget,
      },
    },
    withApiKey(options)
  );

  if (!res.ok) {
    const error = await res.json();
    throw new Error("error" in error ? error.error : "要約生成に失敗しました");
  }

  // Hono RPC: res.ok === true の場合、成功レスポンスの型が推論される
  return res.json();
};
