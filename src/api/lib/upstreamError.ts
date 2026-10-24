import { RetryError } from "ai";
import { z } from "zod";
import { OpenAIApiKeyNotConfiguredError } from "./errors.js";

/** 失敗の分類（上流のエラー文を含まない） */
export type UpstreamErrorCode = "rate_limit" | "quota" | "auth" | "invalid_output" | "upstream";

/**
 * 上流のエラー本文が insufficient_quota（残高・クレジット不足。error.code または error.type）か判定する
 * AI SDK（@ai-sdk/openai）は本文を JSON として解析し APICallError.data（{ error: { code } }）へ入れる。
 * 解析できなかった場合に備え、responseBody（文字列）も解析して確認する
 */
const isInsufficientQuota = (source: unknown): boolean => {
  if (!source || typeof source !== "object") return false;
  const { data, responseBody } = source as { data?: unknown; responseBody?: unknown };
  // 互換プロバイダは code が null で type だけ insufficient_quota になる場合がある
  const isQuotaBody = (body: unknown): boolean => {
    if (!body || typeof body !== "object" || !("error" in body)) return false;
    const inner = (body as { error: unknown }).error;
    if (!inner || typeof inner !== "object") return false;
    const { code, type } = inner as { code?: unknown; type?: unknown };
    return code === "insufficient_quota" || type === "insufficient_quota";
  };
  if (isQuotaBody(data)) return true;
  if (typeof responseBody !== "string") return false;
  try {
    return isQuotaBody(JSON.parse(responseBody));
  } catch {
    return false;
  }
};

/**
 * 上流（OpenAI）の失敗から HTTP ステータスを取り出す（数値でなければ undefined）
 * AI SDK は 429 などを再試行し、上限到達時は RetryError に包んで投げる（statusCode は lastError 側）
 */
export const getUpstreamStatusCode = (error: unknown): number | undefined => {
  const source = RetryError.isInstance(error) ? error.lastError : error;
  const statusCode =
    source && typeof source === "object" && "statusCode" in source
      ? (source as { statusCode: unknown }).statusCode
      : undefined;
  return typeof statusCode === "number" ? statusCode : undefined;
};

/**
 * 上流（OpenAI）の失敗を、上流のエラー文を含まない安全な分類へ変換する
 * クライアントは code から案内文を作る（rate_limit: 待つ / quota: 残高・請求設定を確認する / auth: 設定を直す / それ以外: 再試行）
 */
export const toStageError = (error: unknown): { code: UpstreamErrorCode; retryable: boolean } => {
  if (error instanceof OpenAIApiKeyNotConfiguredError) return { code: "auth", retryable: false };
  // AI の出力は JSON.parse → zod で検証する
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return { code: "invalid_output", retryable: true };
  }
  const statusCode = getUpstreamStatusCode(error);
  // 残高不足の判定は本文を見るため、RetryError なら lastError 側を渡す
  const source = RetryError.isInstance(error) ? error.lastError : error;
  if (statusCode === 401 || statusCode === 403) return { code: "auth", retryable: false };
  // 残高不足も 429 で返るが、待っても直らないため rate_limit とは分ける
  if (statusCode === 429 && isInsufficientQuota(source)) return { code: "quota", retryable: false };
  if (statusCode === 429) return { code: "rate_limit", retryable: true };
  return { code: "upstream", retryable: true };
};

/**
 * toStageError で分類した失敗をログに出すときの level
 * キー未設定は利用者の設定の問題なので debug。一時的な上流の失敗（auth / quota / rate_limit）は warn、
 * 想定外の 500（upstream / invalid_output）は error
 * stageError は呼び出し側で計算済みなら渡す（toStageError を二重に呼ばないため）
 */
export const getStageErrorLogLevel = (
  error: unknown,
  stageError: { code: UpstreamErrorCode } = toStageError(error)
): "debug" | "warn" | "error" => {
  if (error instanceof OpenAIApiKeyNotConfiguredError) return "debug";
  const { code } = stageError;
  return code === "upstream" || code === "invalid_output" ? "error" : "warn";
};

/** 分類ごとの HTTP ステータス（キー未設定・401/403 → 401、429 → 429、残高不足 → 402、それ以外 → 500） */
export const UPSTREAM_ERROR_STATUS = {
  auth: 401,
  rate_limit: 429,
  quota: 402,
  invalid_output: 500,
  upstream: 500,
} as const satisfies Record<UpstreamErrorCode, number>;
