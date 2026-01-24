import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * CSP nonce を格納するコンテキスト変数のキー
 */
export const CSP_NONCE_KEY = "cspNonce";

/**
 * CSP nonce を生成する
 *
 * @description
 * リクエストごとに一意のnonceを生成し、CSPヘッダーとインラインスクリプトで使用する。
 * Base64エンコードされた16バイトのランダム値を使用。
 *
 * @returns Base64エンコードされたnonce文字列
 */
const generateNonce = (): string => {
  return randomBytes(16).toString("base64");
};

/**
 * 静的セキュリティヘッダーの設定値（CSP以外）
 *
 * @description
 * - X-Content-Type-Options: MIME スニッフィング攻撃を防止
 * - X-Frame-Options: クリックジャッキング攻撃を防止
 * - Referrer-Policy: リファラー情報の漏洩を制限
 * - Permissions-Policy: 不要な Web API へのアクセスを制限
 */
const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

/**
 * Content-Security-Policy ヘッダーを生成する
 *
 * @description
 * nonce を使用してインラインスクリプトを許可しつつ、XSS攻撃を緩和する。
 *
 * @param nonce - CSP nonce 値
 * @returns CSP ヘッダー値
 */
const createCSPHeader = (nonce: string): string => {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.openai.com https://export.arxiv.org",
  ].join("; ");
};

/**
 * セキュリティヘッダーミドルウェアを作成する
 *
 * @description
 * 開発環境・本番環境の両方でセキュリティヘッダーを適用する。
 * 本番環境ではリクエストごとにCSP nonceを生成し、インラインスクリプトを安全に許可する。
 * nonceは `c.get(CSP_NONCE_KEY)` でSSRレンダラーから取得可能。
 *
 * @returns Hono ミドルウェアハンドラー
 */
export const createSecurityHeadersMiddleware = (): MiddlewareHandler => {
  const isProd = process.env.NODE_ENV === "production";
  const staticHeaderEntries = Object.entries(STATIC_SECURITY_HEADERS);

  return async (c, next) => {
    // 本番環境ではリクエストごとにnonceを生成してコンテキストに保存
    const nonce = isProd ? generateNonce() : "";
    if (isProd) {
      c.set(CSP_NONCE_KEY, nonce);
    }

    await next();

    // 静的セキュリティヘッダーを追加
    for (const [key, value] of staticHeaderEntries) {
      c.header(key, value);
    }

    // 本番環境ではCSPヘッダーを追加（nonceを含む）
    if (isProd) {
      c.header("Content-Security-Policy", createCSPHeader(nonce));
    }
  };
};
