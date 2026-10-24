import type { Context, MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import type { Env } from "../types/env.js";

/**
 * 同期 API のパス。sync 用バケットで数え、汎用バケットでは数えない
 */
export const SYNC_PATH = "/api/v1/sync";

/**
 * 429 応答の本文。クライアントが code / retryable で再試行可否を判定できるよう JSON で返す
 */
const RATE_LIMIT_MESSAGE = {
  error: "Too many requests, please try again later.",
  code: "rate_limit",
  retryable: true,
};

/**
 * IPv6 アドレスを /64 のプレフィックス（先頭 4 グループ）にまとめる。
 * `::` 省略形を 8 グループに展開してから先頭 4 グループを返す。IPv4 はそのまま返す
 */
const toIpv6Prefix64 = (ip: string): string => {
  if (!ip.includes(":")) return ip;
  // ポート付きの IPv4（1.2.3.4:5678）はポートを除く
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) return ip.slice(0, ip.indexOf(":"));
  // IPv4 埋め込み表記（::ffff:1.2.3.4）は IPv4 として扱う。/64 にすると全 IPv4 が同じキーになるため
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  // ゾーン ID（%eth0）は除く
  const address = ip.split("%")[0] ?? ip;
  const [head = "", tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = tail === undefined ? 0 : Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  const prefix = groups
    .slice(0, 4)
    .map((group) => (Number.parseInt(group, 16) || 0).toString(16))
    .join(":");
  return `${prefix}::/64`;
};

/**
 * IPアドレスベースでクライアントを識別するキーを返す。
 * x-real-ip を優先し、なければ x-forwarded-for の先頭を使う。IPv6 は /64 単位でまとめる
 */
export const getClientKey = (c: Context<{ Bindings: Env }>): string => {
  const ip =
    c.req.header("x-real-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  // 開発環境などでIPアドレスが取得できない場合
  if (!ip) return "unknown";
  return toIpv6Prefix64(ip);
};

/**
 * 同期 API（/api/v1/sync）用のレートリミットミドルウェアの作成
 *
 * arXiv 呼び出しを伴うため、汎用バケットとは別に 12リクエスト/60秒/IP（クライアントは 6 秒間隔で送る前提） で制限します。
 *
 * @description
 * - クライアント識別: IPアドレスベース（x-real-ip 優先、なければ x-forwarded-for。IPv6 は /64）
 * - ストレージ: MemoryStore（インスタンスごと。汎用バケットとは独立）
 * - 標準ヘッダー: draft-6形式のRateLimit-*ヘッダー、超過時は Retry-After も返す
 */
export const createSyncRateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return rateLimiter({
    windowMs: 60 * 1000, // 60秒
    limit: 12, // 12リクエスト
    keyGenerator: getClientKey,
    standardHeaders: "draft-6",
    message: RATE_LIMIT_MESSAGE,
  });
};

/**
 * 汎用 API（/api/v1/* のうち sync 以外）用のレートリミットミドルウェアの作成
 *
 * Embedding・検索・要約など AI 系の呼び出しを 600リクエスト/15分/IP で制限します。
 * sync は専用バケットで数えるため、ここでは skip して二重計上しません。
 *
 * @description
 * - クライアント識別: IPアドレスベース（x-real-ip 優先、なければ x-forwarded-for。IPv6 は /64）
 * - ストレージ: MemoryStore（インスタンスごと。sync バケットとは独立）
 * - 標準ヘッダー: draft-6形式のRateLimit-*ヘッダー、超過時は Retry-After も返す
 */
export const createApiRateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return rateLimiter({
    windowMs: 15 * 60 * 1000, // 15分
    limit: 600, // 600リクエスト
    keyGenerator: getClientKey,
    skip: (c) => c.req.path === SYNC_PATH,
    standardHeaders: "draft-6",
    message: RATE_LIMIT_MESSAGE,
  });
};
