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
import type { SearchRequest, SyncPeriod } from "@/shared/schemas/index";
import { SummaryApiError, toSummaryStageErrorCode } from "./summaryErrorTypes";

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

/** sync を再試行する理由。rate_limit: 429、unavailable: 502/503、network: fetch のネットワーク失敗 */
export type SyncRetryReason = "rate_limit" | "unavailable" | "network";

/** syncApi 専用オプション（再試行の通知用） */
export interface SyncApiOptions extends ApiOptions {
  /** 最初の再試行の前に1回だけ呼ぶ（UI でトースト等を出したい場合）。reason は最初の失敗の理由 */
  onRateLimited?: (reason: SyncRetryReason) => void;
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
 * 設定で API 利用が OFF のときに AI 呼び出し関数が投げるエラー。
 * fetch の前に投げるため、OFF 中は検索・要約・Embedding のリクエストが発生しない。
 */
export class ApiDisabledError extends Error {
  /** 再開方法（キー保存済みかどうかで案内を分ける） */
  readonly resumeHint: string;

  constructor(resumeHint = getApiResumeHint(true)) {
    super(`API利用がOFFのため、AI処理（検索・要約・Embedding補完）を停止しています。${resumeHint}`);
    this.name = "ApiDisabledError";
    this.resumeHint = resumeHint;
  }
}

/**
 * API利用OFFからの再開方法。
 * キー未保存のときは「利用可能」スイッチを操作できないため、先にキーの保存を案内する。
 */
export const getApiResumeHint = (hasApiKey: boolean): string =>
  hasApiKey
    ? "設定の「利用可能」をONにすると再開できます。"
    : "設定でAPIキーを保存し、「利用可能」をONにすると再開できます。";

/** 設定で API 利用が OFF か */
const isApiDisabled = (): boolean => useSettingsStore.getState().apiEnabled === false;

/**
 * AI 呼び出しの実行境界。設定で API 利用が OFF なら ApiDisabledError を投げる。
 *
 * @remarks
 * APIキー未設定（apiEnabled は既定の true）の場合は止めない。サーバー側のキー解決に委ねる。
 */
export const assertApiEnabled = (): void => {
  if (isApiDisabled()) {
    throw new ApiDisabledError(getApiResumeHint(useSettingsStore.getState().apiKey.length > 0));
  }
};

/**
 * 復号済み API key のキャッシュ（PBKDF2 復号の遅延を避ける）
 * ストアの apiKey が変わったらキャッシュは無効になる
 */
let cachedDecryptedKey: { encrypted: string; plain: string } | null = null;

/**
 * 復号中の Promise（同一暗号文で並列復号すると OperationError が出るため直列化する）
 */
let inFlightDecrypt: { stored: string; promise: Promise<string | undefined> } | null = null;

/**
 * settingsStore から復号化された API key を取得する
 *
 * @description
 * API 呼び出し前にこの関数を使用して平文の API key を取得し、
 * searchApi/syncApi/summaryApi の options に渡す。
 * 同一セッションで同じ暗号文ならキャッシュを返す（復号は PBKDF2 で重いため）。
 * 同じ暗号文に対する並列呼び出しは 1 本にまとめ、crypto.subtle.decrypt の OperationError を防ぐ。
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
    inFlightDecrypt = null;
    return undefined;
  }
  const stored = store.apiKey;
  if (!stored) {
    cachedDecryptedKey = null;
    inFlightDecrypt = null;
    return undefined;
  }
  if (cachedDecryptedKey?.encrypted === stored) {
    return cachedDecryptedKey.plain || undefined;
  }
  if (inFlightDecrypt?.stored === stored) {
    await inFlightDecrypt.promise;
    return cachedDecryptedKey?.encrypted === stored
      ? cachedDecryptedKey.plain || undefined
      : undefined;
  }
  const doDecrypt = async (): Promise<string | undefined> => {
    const plainKey = await store.getApiKeyAsync();
    cachedDecryptedKey = { encrypted: stored, plain: plainKey };
    return plainKey || undefined;
  };
  const isOperationError = (e: unknown): boolean =>
    Boolean(
      (e instanceof Error && e.name === "OperationError") ||
        (e &&
          typeof (e as { name?: string }).name === "string" &&
          (e as { name: string }).name === "OperationError")
    );
  const promise = (async (): Promise<string | undefined> => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await doDecrypt();
        } catch (e) {
          if (attempt < 2 && isOperationError(e)) continue;
          throw e;
        }
      }
      return undefined;
    } finally {
      if (inFlightDecrypt?.stored === stored) {
        inFlightDecrypt = null;
      }
    }
  })();
  inFlightDecrypt = { stored, promise };
  return promise;
};

/**
 * 検索API（/api/v1/search）が失敗ステータスを返したときに投げるエラー。
 * status で「設定を直す（401/403）」「時間をおいて再試行する（429）」などの案内を出し分ける。
 * message は固定文言（上流のエラー文は含めない）。
 */
export class SearchApiError extends Error {
  readonly status: number;
  /** サーバーが返した失敗の分類（本文が JSON でない応答では undefined） */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SearchApiError";
    this.status = status;
    this.code = code;
  }
}

/** 失敗応答の本文から分類（code）を読む。JSON でない・code がない場合は undefined */
const readErrorCode = async (res: Response): Promise<string | undefined> => {
  const body: { code?: unknown } | null = await res.json().catch(() => null);
  return typeof body?.code === "string" ? body.code : undefined;
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
  assertApiEnabled();
  const res = await client.api.v1.search.$post(
    { json: request },
    { ...withApiKey(options), init: { signal: options?.signal } }
  );

  if (!res.ok) {
    // 応答の error（旧形式では上流のエラー文）は使わない。ゲートウェイの応答は JSON とは限らないため、
    // 本文ではなく status で失敗を分類する
    // RPC の型はサーバーが返すステータスだけに絞られるため、ミドルウェア・ゲートウェイの値も扱えるよう number で受ける
    const status: number = res.status;
    // 402 はゲートウェイ（Vercel の DEPLOYMENT_DISABLED など）も返すため、サーバーの分類（code: "quota"）がある場合だけ残高不足として扱う
    const code = status === 402 ? await readErrorCode(res) : undefined;
    throw new SearchApiError("検索に失敗しました", status, code);
  }

  // Hono RPC: res.ok === true の場合、成功レスポンスの型が推論される
  return res.json();
};

/** 未取得時は 1 req/秒で開始（保守的だった 2秒から短縮）。429 時は EmbeddingRateLimitError で停止し次回再開。 */
const FALLBACK_MIN_INTERVAL_MS = 1_000;

/** Embedding 応答の RateLimit-* から更新する共有状態（sync はサーバーで別バケットのため使わない） */
let rateLimitRemaining: number | null = null;
/** ウィンドウリセット時刻（Unix ms）。draft-6 の RateLimit-Reset は秒で返る想定 */
let rateLimitResetAtMs: number | null = null;
/** 直近で embedding リクエストを送った時刻（ms）。未送信時は null。初回は待機スキップ用。 */
let lastEmbeddingSentAtMs: number | null = null;

/** RateLimit-Reset: この値未満は「残り秒数」、以上は絶対時刻（Unix秒） */
const RATE_LIMIT_RESET_THRESHOLD_SEC = 1e9;
/** RateLimit-Reset: この値以上なら値がすでにミリ秒として渡っている */
const RATE_LIMIT_RESET_ALREADY_MS = 1e10;

/**
 * Embedding 応答のヘッダーから RateLimit-* をパースし共有状態を更新する。
 * sync は別バケット（IP ごとに 12件/60秒）のため、sync 応答では呼ばない。
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
      const isRelativeSec = resetSec < RATE_LIMIT_RESET_THRESHOLD_SEC;
      const asAbsoluteMs = resetSec < RATE_LIMIT_RESET_ALREADY_MS ? resetSec * 1000 : resetSec;
      rateLimitResetAtMs = isRelativeSec ? Date.now() + resetSec * 1000 : asAbsoluteMs;
    }
  }
};

/** 推奨並列数の上限。残り枠が多くても OpenAI 側の負荷と 429 を避けるため抑える */
const MAX_RECOMMENDED_CONCURRENCY = 4;

/**
 * レートリミット残り枠に応じた推奨並列数（1〜4）。
 * backfill の並列オートスケール用。未取得時は 3 で開始（従来の 1 より速く、429 を避けやすい）。
 */
export const getRecommendedConcurrency = (): number =>
  Math.min(MAX_RECOMMENDED_CONCURRENCY, Math.max(1, rateLimitRemaining ?? 3));

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
 * 初回（lastEmbeddingSentAtMs === null）は待機せず即 return し、最初の 1 本を早く発火させる。
 *
 * @param slotsUsed この送信で消費するスロット数。省略時は getRecommendedConcurrency() を使う（単一並列用）。
 * バッチ API は 1 リクエスト = 1 スロットなので 1 を渡すと 2 回目以降の待ちが短くなる。
 */
const waitForEmbeddingInterval = async (slotsUsed?: number): Promise<void> => {
  if (lastEmbeddingSentAtMs === null) return;

  const intervalMs = getEmbeddingDelayMs();
  const slots = slotsUsed !== undefined ? slotsUsed : getRecommendedConcurrency();
  const delayMs = intervalMs * slots;
  const waitUntil = lastEmbeddingSentAtMs + delayMs;
  const now = Date.now();
  if (now < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, waitUntil - now));
  }
};

/**
 * Embedding API が 429（Too Many Requests）を返したときに投げるエラー。
 * バックフィルではこのエラーで「今回の取得を止め、次回『Embeddingを補完』で続きから再開する」と判定する。
 */
export class EmbeddingRateLimitError extends Error {
  readonly status = 429;

  constructor(
    message = "Embeddingのレート制限に達しました。次回「Embeddingを補完」で続きから取得できます。"
  ) {
    super(message);
    this.name = "EmbeddingRateLimitError";
  }
}

/**
 * Embedding API が 429 以外のエラーを返したときに投げるエラー。
 * status で「設定を直す（401/403）」「再試行する（5xx）」などの案内を出し分ける。
 */
export class EmbeddingApiError extends Error {
  readonly status: number;
  /** サーバーが返した失敗の分類（本文が JSON でない応答では undefined） */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "EmbeddingApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 同期API（/api/v1/sync）が 429（Too Many Requests）を返したときに投げるエラー。
 * リトライ上限に達した場合に throw され、UI で「状況」と「どうするか」を表示するために用いる。
 */
export class SyncRateLimitError extends Error {
  readonly status = 429;
  /** Retry-After ヘッダの値（秒）。未設定の場合は undefined */
  readonly retryAfterSec: number | undefined;

  constructor(
    message = "リクエストが集中しています。しばらく待ってから再度お試しください。",
    retryAfterSec?: number
  ) {
    super(message);
    this.name = "SyncRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** Embedding 429 で 1 回だけ待って再送する Retry-After の上限（秒）。超える場合は待たずに中断する */
const EMBEDDING_RETRY_AFTER_MAX_SEC = 30;

/** Retry-After ヘッダー（秒）を読む。無い・数値でない・0 以下なら undefined */
const parseRetryAfterSec = (header: string | null): number | undefined => {
  const sec = header ? parseInt(header, 10) : NaN;
  return Number.isNaN(sec) || sec <= 0 ? undefined : sec;
};

/**
 * Embedding リクエストを送り、429 で Retry-After が 1〜30 秒なら 1 回だけ待って再送する。
 * Retry-After が無い・30 秒を超える場合は再送せず 429 をそのまま返す（handleEmbeddingResponse で EmbeddingRateLimitError）。
 * 待機中に API 利用を OFF にされた場合は再送しない。signal で中断されたら AbortError を投げる。
 */
const postEmbeddingWithRetry = async <R extends Response>(
  post: () => Promise<R>,
  signal?: AbortSignal
): Promise<R> => {
  const res = await post();
  if ((res.status as number) !== 429) return res;
  const retryAfterSec = parseRetryAfterSec(res.headers.get("retry-after"));
  if (retryAfterSec === undefined || retryAfterSec > EMBEDDING_RETRY_AFTER_MAX_SEC) return res;
  updateRateLimitFromResponse(res);
  await waitForSyncRetryDelay(retryAfterSec * 1000, signal);
  assertApiEnabled();
  return post();
};

/**
 * Embedding API レスポンスの共通処理
 *
 * RateLimit ヘッダー更新・429/エラーチェック・タイムスタンプ更新・レスポンス JSON 返却を一括で行う。
 * embeddingApi / embeddingBatchApi の共通後処理として使用する。
 *
 * @throws EmbeddingRateLimitError 429 時
 * @throws EmbeddingApiError その他のエラー時
 */
const handleEmbeddingResponse = async <T>(res: Response): Promise<T> => {
  updateRateLimitFromResponse(res);

  // レートリミット middleware が 429 を返す場合がある（RPC 型には含まれないため status を number で比較）
  if (!res.ok && (res.status as number) === 429) {
    throw new EmbeddingRateLimitError();
  }

  if (!res.ok) {
    // 応答の error（旧形式では上流のエラー文）は使わず、status で分類する
    const code = res.status === 402 ? await readErrorCode(res) : undefined;
    throw new EmbeddingApiError("Embeddingの取得に失敗しました", res.status, code);
  }

  lastEmbeddingSentAtMs = Date.now();
  return res.json() as Promise<T>;
};

/**
 * Embedding API
 *
 * テキストから Embedding ベクトルを生成する。
 * 429 のときは Retry-After が 30 秒以内なら 1 回だけ待って再送し、それでも 429 なら EmbeddingRateLimitError を投げる。
 * 呼び出し元（バックフィル）はこのエラーで停止し、次回再開する。
 *
 * @param request { text: string } 対象テキスト（1〜8000文字）
 * @param options APIオプション
 * @returns embedding 配列（1536次元）
 * @throws EmbeddingRateLimitError 429 が続いた・Retry-After が無いか 30 秒を超える時
 * @throws Error その他の API エラー時
 */
export const embeddingApi = async (
  request: { text: string },
  options?: ApiOptions
): Promise<{ embedding: number[] }> => {
  assertApiEnabled();
  const opts = withApiKey(options);
  await waitForEmbeddingInterval();
  // 送信間隔の待機中に OFF にされた場合も送らない
  assertApiEnabled();
  const res = await postEmbeddingWithRetry(
    () => client.api.v1.embedding.$post({ json: request }, opts),
    options?.signal
  );
  return handleEmbeddingResponse<{ embedding: number[] }>(res);
};

/**
 * バッチ Embedding API
 *
 * 複数テキストを1リクエストで Embedding に変換する。429 の扱いは embeddingApi と同じ（Retry-After 30 秒以内なら 1 回だけ再送）。
 *
 * @param request { texts: string[] } 対象テキスト配列（1〜EMBEDDING_BATCH_MAX_SIZE 件）
 * @param options APIオプション
 * @returns embeddings 配列（入力順、各要素は 1536 次元）
 * @throws EmbeddingRateLimitError 429 が続いた・Retry-After が無いか 30 秒を超える時
 * @throws Error その他の API エラー時
 */
export const embeddingBatchApi = async (
  request: { texts: string[] },
  options?: ApiOptions
): Promise<{ embeddings: number[][] }> => {
  assertApiEnabled();
  const opts = withApiKey(options);
  // バッチ 1 リクエスト = 1 スロット。2 回目以降の待ちを短くする
  await waitForEmbeddingInterval(1);
  // 送信間隔の待機中に OFF にされた場合も送らない
  assertApiEnabled();
  const res = await postEmbeddingWithRetry(
    () => client.api.v1.embedding.batch.$post({ json: request }, opts),
    options?.signal
  );
  return handleEmbeddingResponse<{ embeddings: number[][] }>(res);
};

/**
 * 同期APIの入力型（デフォルト値を持つフィールドはオプショナル）
 */
type SyncApiInput = {
  categories: string[];
  period?: SyncPeriod;
  maxResults?: number;
  /** 開始位置（ページング用） */
  start?: number;
  /** 取得範囲の開始日（YYYY-MM-DD）。指定時はこの日〜今日を範囲とする */
  fromDate?: string;
  /** 取得範囲の終了日（YYYY-MM-DD）。指定時は範囲を [toDate − period, toDate] とする */
  toDate?: string;
  /** 既に保持している論文の ID。サーバは含まれる論文の Embedding を生成しない。 */
  existingPaperIds?: string[];
};

/** sync リトライ: 最大回数（429/502/503 とネットワーク失敗が対象。504 は関数タイムアウトで再送すると OpenAI の費用が重複するため除く） */
const SYNC_MAX_RETRIES = 3;
/** sync 送信の最小間隔（ms）。サーバーの上限（IP ごとに 12 件/60 秒）に対し、リトライ分の余裕を残す */
const SYNC_MIN_INTERVAL_MS = 6_000;
/** sync リトライ: 指数バックオフの基準（ms）。n 回目の待ちは 3000 × 2^n 以上 */
const SYNC_RETRY_BASE_DELAY_MS = 3_000;
/** sync リトライ: 待ちの上限（ms） */
const SYNC_RETRY_MAX_DELAY_MS = 60_000;
/** sync リトライ: ジッターの最大比率（待ちに 0〜20% を加える） */
const SYNC_RETRY_JITTER_RATIO = 0.2;

/** 直近で sync を送った（または送る予定の）時刻（ms）。未送信時は null。全 sync 呼び出しで共有する */
let lastSyncSentAtMs: number | null = null;

/** テスト用: sync の送信間隔の状態を初期化する */
export const resetSyncIntervalForTest = (): void => {
  lastSyncSentAtMs = null;
};

/** 429 時のユーザー向けメッセージを組み立てる（Retry-After があれば秒数を含める） */
const formatSyncRateLimitMessage = (retryAfterSec: number | undefined): string =>
  typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? `リクエストが集中しています。${retryAfterSec}秒ほど待ってから再度お試しください。`
    : "リクエストが集中しています。しばらく待ってから再度お試しください。";

/**
 * リトライ前に待機する ms。
 * max(Retry-After, 3 秒 × 2^retryCount) にジッター 0〜20% を加え、60 秒で打ち切る。
 */
const computeSyncRetryDelayMs = (retryAfterSec: number | undefined, retryCount: number): number => {
  const baseMs = Math.max((retryAfterSec ?? 0) * 1000, SYNC_RETRY_BASE_DELAY_MS * 2 ** retryCount);
  const jitter = 1 + Math.random() * SYNC_RETRY_JITTER_RATIO;
  return Math.min(SYNC_RETRY_MAX_DELAY_MS, baseMs * jitter);
};

/** AbortSignal に対応した待機。停止時は即座に AbortError を投げる。 */
const waitForSyncRetryDelay = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Sync aborted", "AbortError"));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Sync aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * 前回の sync 送信から最小間隔（6 秒）が空くまで待つ。初回は待たない。
 * 送信枠は待つ前に予約するため、並行して呼ばれても 6 秒ずつずれて送られる。
 * 待機中に中断されたら予約を取り消す（後続の予約がすでに入っていれば、その間隔を崩さないよう何もしない）。
 */
const waitForSyncInterval = async (signal?: AbortSignal): Promise<void> => {
  const now = Date.now();
  const previousSentAtMs = lastSyncSentAtMs;
  const sendAtMs =
    lastSyncSentAtMs === null ? now : Math.max(now, lastSyncSentAtMs + SYNC_MIN_INTERVAL_MS);
  lastSyncSentAtMs = sendAtMs;
  if (sendAtMs > now) {
    try {
      await waitForSyncRetryDelay(sendAtMs - now, signal);
    } catch (e) {
      if (lastSyncSentAtMs === sendAtMs) lastSyncSentAtMs = previousSentAtMs;
      throw e;
    }
    // 背面タブでタイマーが遅れた場合は、次の間隔を実際の送信時刻から数える
    if (lastSyncSentAtMs === sendAtMs) lastSyncSentAtMs = Math.max(sendAtMs, Date.now());
  }
};

/**
 * 同期API
 *
 * arXiv論文を取得し、Embeddingを生成する。
 * API 利用が OFF のときは skipEmbedding を送り、arXiv 取得のみ行う（Embedding は生成しない）。
 * 送信間隔は全呼び出しで最小 6 秒に保つ（サーバーの上限は IP ごとに 12 件/60 秒）。
 * 429/502/503 とネットワーク失敗は指数バックオフ（Retry-After が長ければそちら）で最大 3 回リトライする。
 * 504（関数タイムアウト）はサーバー側で OpenAI を呼んだ後の可能性があるため再送しない。
 * Retry-After が 60 秒を超える 429 は待たずに SyncRateLimitError を投げる。
 *
 * @param request 同期リクエスト
 * @param options APIオプション
 * @returns 同期レスポンス（RPC型推論）
 * @throws SyncRateLimitError 429 が続いた・Retry-After が 60 秒を超える時
 * @throws Error APIエラー時・最後の試行もネットワーク失敗だった時（元の例外は cause）
 */
export const syncApi = async (request: SyncApiInput, options?: SyncApiOptions) => {
  const opts = { ...withApiKey(options), signal: options?.signal };
  const body = {
    categories: request.categories,
    period: request.period ?? "30",
    maxResults: request.maxResults,
    start: request.start ?? 0,
    ...(request.fromDate != null ? { fromDate: request.fromDate } : {}),
    ...(request.toDate != null ? { toDate: request.toDate } : {}),
    ...(request.existingPaperIds != null && request.existingPaperIds.length > 0
      ? { existingPaperIds: request.existingPaperIds }
      : {}),
  };
  // arXiv 取得は AI 呼び出しではないため継続し、Embedding 生成だけを止める。
  // リトライの再送時にも OFF を再評価する
  const withEmbeddingFlag = () => (isApiDisabled() ? { ...body, skipEmbedding: true } : body);
  const send = async () => {
    await waitForSyncInterval(opts.signal);
    return client.api.v1.sync.$post({ json: withEmbeddingFlag() }, opts);
  };

  const isRetryableStatus = (s: number) => s === 429 || s === 502 || s === 503;
  let lastRes: Awaited<ReturnType<typeof send>>;
  for (let retryCount = 0; ; retryCount++) {
    let res: Awaited<ReturnType<typeof send>> | null = null;
    try {
      res = await send();
    } catch (e) {
      // fetch のネットワーク失敗（TypeError）だけリトライする。AbortError などはそのまま投げる
      if (!(e instanceof TypeError)) throw e;
      if (retryCount >= SYNC_MAX_RETRIES) {
        throw new Error(
          "ネットワークに接続できませんでした。接続を確認してから再度お試しください。",
          { cause: e }
        );
      }
    }
    const retryAfterSec = res ? parseRetryAfterSec(res.headers.get("retry-after")) : undefined;
    if (res) {
      lastRes = res;
      if (res.ok || !isRetryableStatus(res.status) || retryCount >= SYNC_MAX_RETRIES) break;
      // 長い Retry-After の 429 は待たずに打ち切る（下で SyncRateLimitError にする）
      if (
        res.status === 429 &&
        retryAfterSec !== undefined &&
        retryAfterSec * 1000 > SYNC_RETRY_MAX_DELAY_MS
      ) {
        break;
      }
    }
    if (retryCount === 0) {
      options?.onRateLimited?.(
        !res ? "network" : res.status === 429 ? "rate_limit" : "unavailable"
      );
    }
    await waitForSyncRetryDelay(computeSyncRetryDelayMs(retryAfterSec, retryCount), opts.signal);
  }

  if (!lastRes.ok) {
    const bodyText = await lastRes.text().catch(() => "");
    let detail = "";
    try {
      const parsed = JSON.parse(bodyText) as { error?: string };
      detail = parsed?.error ?? bodyText.slice(0, 200);
    } catch {
      detail = bodyText.slice(0, 200);
    }
    if (lastRes.status === 429) {
      const retryAfterSec = parseRetryAfterSec(lastRes.headers.get("retry-after"));
      throw new SyncRateLimitError(formatSyncRateLimitMessage(retryAfterSec), retryAfterSec);
    }
    throw new Error(
      detail ? `Sync failed: ${lastRes.status}: ${detail}` : `Sync failed: ${lastRes.status}`
    );
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
  assertApiEnabled();
  const res = await client.api.v1.summary[":id"].$post(
    {
      // RPC クライアントはパスパラメータをエンコードしないため、旧形式の ID のスラッシュを %2F にする（Issue #108）
      param: { id: encodeURIComponent(paperId) },
      json: {
        language: request.language,
        abstract: request.abstract,
        generateTarget: request.generateTarget,
      },
    },
    withApiKey(options)
  );

  if (!res.ok) {
    // 応答の error（旧形式では上流のエラー文）は表示に使わず、code から案内文を作る
    // code がない応答（旧形式、ゲートウェイのエラーページ）はステータスから補う
    const body: { code?: unknown; retryable?: unknown } | null = await res.json().catch(() => null);
    // RPC の型はサーバーが返すステータスだけに絞られるため、ミドルウェア・ゲートウェイの値も扱えるよう number で受ける
    const status: number = res.status;
    const code =
      body?.code !== undefined
        ? toSummaryStageErrorCode(body.code)
        : status === 429
          ? "rate_limit"
          : status === 401 || status === 403
            ? "auth"
            : status === 400
              ? "invalid_input"
              : "upstream";
    // retryable がない場合の既定は、サーバー（summary.ts）と同じく auth・quota・invalid_input（400）だけ再試行不可とする
    const retryable =
      typeof body?.retryable === "boolean"
        ? body.retryable
        : code !== "auth" && code !== "quota" && code !== "invalid_input";
    throw new SummaryApiError(code, retryable);
  }

  // Hono RPC: res.ok === true の場合、成功レスポンスの型が推論される
  return res.json();
};
