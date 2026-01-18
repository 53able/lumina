import type { MiddlewareHandler } from "hono";

/**
 * セキュリティヘッダーの設定値
 *
 * @description
 * - X-Content-Type-Options: MIME スニッフィング攻撃を防止
 * - X-Frame-Options: クリックジャッキング攻撃を防止
 * - Referrer-Policy: リファラー情報の漏洩を制限
 * - Permissions-Policy: 不要な Web API へのアクセスを制限
 * - Content-Security-Policy: XSS 攻撃を緩和
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.openai.com https://export.arxiv.org",
  ].join("; "),
};

/**
 * セキュリティヘッダーミドルウェアを作成する
 *
 * @description
 * 開発環境・本番環境の両方でセキュリティヘッダーを適用する。
 * Vercel 本番環境では vercel.json の headers 設定も併用される。
 *
 * @returns Hono ミドルウェアハンドラー
 */
export const createSecurityHeadersMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();

    // レスポンスにセキュリティヘッダーを追加
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      c.header(key, value);
    }
  };
};
