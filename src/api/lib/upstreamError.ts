import { RetryError } from "ai";
import { z } from "zod";
import { OpenAIApiKeyNotConfiguredError } from "../services/openai";

/** 失敗の分類（上流のエラー文を含まない） */
export type UpstreamErrorCode = "rate_limit" | "auth" | "invalid_output" | "upstream";

/**
 * 上流（OpenAI）の失敗を、上流のエラー文を含まない安全な分類へ変換する
 * クライアントは code から案内文を作る（rate_limit: 待つ / auth: 設定を直す / それ以外: 再試行）
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
  if (statusCode === 429) return { code: "rate_limit", retryable: true };
  return { code: "upstream", retryable: true };
};

/** 分類ごとの HTTP ステータス（キー未設定・401/403 → 401、429 → 429、それ以外 → 500） */
export const UPSTREAM_ERROR_STATUS = {
  auth: 401,
  rate_limit: 429,
  invalid_output: 500,
  upstream: 500,
} as const satisfies Record<UpstreamErrorCode, number>;
