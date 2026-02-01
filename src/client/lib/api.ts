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
  /** リクエスト中止用の AbortSignal（同期中止など） */
  signal?: AbortSignal;
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
 * 復号済み API key のキャッシュ（PBKDF2 復号の遅延を避ける）
 * ストアの apiKey が変わったらキャッシュは無効になる
 */
let cachedDecryptedKey: { encrypted: string; plain: string } | null = null;

/**
 * settingsStore から復号化された API key を取得する
 *
 * @description
 * API 呼び出し前にこの関数を使用して平文の API key を取得し、
 * searchApi/syncApi/summaryApi の options に渡す。
 * 同一セッションで同じ暗号文ならキャッシュを返す（復号は PBKDF2 で重いため）。
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
  if (!store.canUseApi()) {
    cachedDecryptedKey = null;
    return undefined;
  }
  const stored = store.apiKey;
  if (!stored) {
    cachedDecryptedKey = null;
    return undefined;
  }
  if (cachedDecryptedKey?.encrypted === stored) {
    return cachedDecryptedKey.plain || undefined;
  }
  const plainKey = await store.getApiKeyAsync();
  cachedDecryptedKey = { encrypted: stored, plain: plainKey };
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

/** 未取得時は 1 req/2秒で開始。429 時は EmbeddingRateLimitError で停止し次回再開。 */
const FALLBACK_MIN_INTERVAL_MS = 2_000;

/** レスポンスの RateLimit-* から更新する共有状態（sync / embedding 同一バケット） */
let rateLimitRemaining: number | null = null;
/** ウィンドウリセット時刻（Unix ms）。draft-6 の RateLimit-Reset は秒で返る想定 */
let rateLimitResetAtMs: number | null = null;

/**
 * レスポンスヘッダーから RateLimit-* をパースし共有状態を更新する。
 * sync / embedding は同一レートリミットバケットのため、どちらのレスポンスでも更新する。
 */
const updateRateLimitFromResponse = (res: Response): void => {
  if (!res?.headers) return;
  const remainingRaw = res.headers.get("RateLimit-Remaining");
  const resetRaw = res.headers.get("RateLimit-Reset");
  if (remainingRaw !== null) {
    const parsed = parseInt(remainingRaw, 10);
    if (!Number.isNaN(parsed)) rateLimitRemaining = parsed;
  }
  if (resetRaw !== null) {
    const resetSec = parseInt(resetRaw, 10);
    if (!Number.isNaN(resetSec)) {
      // 絶対時刻(Unix秒)なら 1e9 以上。それ未満は「残り秒数」として now + 秒 に解釈する
      const asAbsoluteMs = resetSec < 1e10 ? resetSec * 1000 : resetSec;
      rateLimitResetAtMs =
        resetSec < 1e9 ? Date.now() + resetSec * 1000 : asAbsoluteMs;
    }
  }
};

/**
 * レートリミット残り枠に応じた推奨並列数（1〜10）。
 * backfill の並列オートスケール用。未取得時は 1 で控えめにする。
 */
export const getRecommendedConcurrency = (): number =>
  Math.min(10, Math.max(1, rateLimitRemaining ?? 1));

/**
 * 次の embedding 送信までに待つべき ms。
 * ヘッダーがある場合は remaining / (reset までの時間) で均等に割り、なければ固定間隔。
 */
const getEmbeddingDelayMs = (): number => {
  const now = Date.now();
  if (rateLimitRemaining === null || rateLimitResetAtMs === null) {
    return FALLBACK_MIN_INTERVAL_MS;
  }
  const windowLeftMs = rateLimitResetAtMs - now;
  if (windowLeftMs <= 0) return FALLBACK_MIN_INTERVAL_MS;
  if (rateLimitRemaining <= 0) return windowLeftMs;
  const intervalMs = windowLeftMs / rateLimitRemaining;
  return Math.min(Math.max(intervalMs, 0), 60_000);
};

/**
 * 送信間隔を守る。バックエンドの RateLimit-* に応じて待機時間をオートスケールする。
 */
const waitForEmbeddingInterval = async (): Promise<void> => {
  const intervalMs = getEmbeddingDelayMs();
  const concurrency = getRecommendedConcurrency();
  // 並列 N で「1リクエスト/interval」を守るため、バッチ間隔は N * interval にする
  const delayMs = intervalMs * concurrency;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
};

/**
 * Embedding API が 429（Too Many Requests）を返したときに投げるエラー。
 * バックフィルではこのエラーで「今回の取得を止め、次回『Embeddingを補完』で続きから再開する」と判定する。
 */
export class EmbeddingRateLimitError extends Error {
  readonly status = 429;

  constructor(message = "Embeddingのレート制限に達しました。次回「Embeddingを補完」で続きから取得できます。") {
    super(message);
    this.name = "EmbeddingRateLimitError";
  }
}

/**
 * Embedding API
 *
 * テキストから Embedding ベクトルを生成する。
 * 429 のときはリトライせず EmbeddingRateLimitError を投げる。呼び出し元（バックフィル）で停止し、次回再開する。
 *
 * @param request { text: string } 対象テキスト（1〜8000文字）
 * @param options APIオプション
 * @returns embedding 配列（1536次元）
 * @throws EmbeddingRateLimitError 429 時
 * @throws Error その他の API エラー時
 */
export const embeddingApi = async (
  request: { text: string },
  options?: ApiOptions
): Promise<{ embedding: number[] }> => {
  const opts = withApiKey(options);

  await waitForEmbeddingInterval();
  const res = await client.api.v1.embedding.$post({ json: request }, opts);
  updateRateLimitFromResponse(res);

  if (!res.ok && res.status === 429) {
    throw new EmbeddingRateLimitError();
  }

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

/** sync 429 リトライ: 最大回数（embedding と同一バケットのため 429 になりうる） */
const SYNC_RATE_LIMIT_MAX_RETRIES = 3;
/** sync 429 リトライ: Retry-After が無い／無効なときの最小待機（ms） */
const EMBEDDING_RATE_LIMIT_MIN_BACKOFF_MS = 2_000;

/**
 * 同期API
 *
 * arXiv論文を取得し、Embeddingを生成する。
 * 429（Too Many Requests）のときは Retry-After に従ってリトライする（embedding と同一レートリミットバケットのため）。
 *
 * @param request 同期リクエスト
 * @param options APIオプション
 * @returns 同期レスポンス（RPC型推論）
 * @throws Error APIエラー時
 */
export const syncApi = async (request: SyncApiInput, options?: ApiOptions) => {
  const opts = { ...withApiKey(options), signal: options?.signal };
  const body = {
    categories: request.categories,
    period: request.period ?? "30",
    maxResults: request.maxResults ?? 50,
    start: request.start ?? 0,
  };

  let lastRes = await client.api.v1.sync.$post({ json: body }, opts);
  updateRateLimitFromResponse(lastRes);
  let retryCount = 0;

  while (!lastRes.ok && lastRes.status === 429 && retryCount < SYNC_RATE_LIMIT_MAX_RETRIES) {
    if (opts.signal?.aborted) {
      throw new DOMException("Sync aborted", "AbortError");
    }
    const retryAfterSecRaw = lastRes.headers.get("retry-after");
    const retryAfterSec = retryAfterSecRaw ? parseInt(retryAfterSecRaw, 10) : NaN;
    const delayMs =
      Number.isNaN(retryAfterSec) || retryAfterSec <= 0
        ? EMBEDDING_RATE_LIMIT_MIN_BACKOFF_MS
        : Math.max(1000, retryAfterSec * 1000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    retryCount += 1;
    lastRes = await client.api.v1.sync.$post({ json: body }, opts);
    updateRateLimitFromResponse(lastRes);
  }

  if (!lastRes.ok) {
    throw new Error(`Sync failed: ${lastRes.status}`);
  }

  return lastRes.json();
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
