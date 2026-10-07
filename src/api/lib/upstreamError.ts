import { RetryError } from "ai";
import { z } from "zod";
import { OpenAIApiKeyNotConfiguredError } from "../services/openai";

/** 失敗の分類（上流のエラー文を含まない） */
export type UpstreamErrorCode = "rate_limit" | "quota" | "auth" | "invalid_output" | "upstream";

/**
 * 上流のエラー本文が insufficient_quota（残高・クレジット不足）か判定する
 * AI SDK（@ai-sdk/openai）は本文を JSON として解析し APICallError.data（{ error: { code } }）へ入れる。
 * 解析できなかった場合に備え、responseBody（文字列）も解析して確認する
 */
const isInsufficientQuota = (source: unknown): boolean => {
  if (!source || typeof source !== "object") return false;
  const { data, responseBody } = source as { data?: unknown; responseBody?: unknown };
  const codeOf = (body: unknown): unknown => {
    if (!body || typeof body !== "object" || !("error" in body)) return undefined;
    const inner = (body as { error: unknown }).error;
    return inner && typeof inner === "object" && "code" in inner
      ? (inner as { code: unknown }).code
      : undefined;
  };
  if (codeOf(data) === "insufficient_quota") return true;
  if (typeof responseBody !== "string") return false;
  try {
    return codeOf(JSON.parse(responseBody)) === "insufficient_quota";
  } catch {
    return false;
  }
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
  // AI SDK は 429 などを再試行し、上限到達時は RetryError に包んで投げる（statusCode は lastError 側）
  const source = RetryError.isInstance(error) ? error.lastError : error;
  const statusCode =
    source && typeof source === "object" && "statusCode" in source
      ? (source as { statusCode: unknown }).statusCode
      : undefined;
  if (statusCode === 401 || statusCode === 403) return { code: "auth", retryable: false };
  // 残高不足も 429 で返るが、待っても直らないため rate_limit とは分ける
  if (statusCode === 429 && isInsufficientQuota(source)) return { code: "quota", retryable: false };
  if (statusCode === 429) return { code: "rate_limit", retryable: true };
  return { code: "upstream", retryable: true };
};

/** 分類ごとの HTTP ステータス（キー未設定・401/403 → 401、429 → 429、残高不足 → 402、それ以外 → 500） */
export const UPSTREAM_ERROR_STATUS = {
  auth: 401,
  rate_limit: 429,
  quota: 402,
  invalid_output: 500,
  upstream: 500,
} as const satisfies Record<UpstreamErrorCode, number>;
