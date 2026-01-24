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
const createSecurityHeaders = (): Readonly<Record<string, string>> => {
  const isProd = process.env.NODE_ENV === "production";

  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

  // 開発環境では Vite デブサーバー (localhost:5173) からのスクリプト/スタイルを許可するため、
  // 厳格な Content-Security-Policy は本番環境のみに適用する。
  if (isProd) {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self' https://api.openai.com https://export.arxiv.org",
    ].join("; ");
  }

  return Object.freeze(headers);
};

/**
 * セキュリティヘッダーミドルウェアを作成する
 *
 * @description
 * 開発環境・本番環境の両方でセキュリティヘッダーを適用する。
 * Vercel 本番環境では vercel.json の headers 設定も併用される。
 * ヘッダーオブジェクトは一度だけ作成され、すべてのリクエストで再利用される。
 *
 * @returns Hono ミドルウェアハンドラー
 */
export const createSecurityHeadersMiddleware = (): MiddlewareHandler => {
  // ヘッダーオブジェクトを一度だけ作成して再利用（パフォーマンス最適化）
  const SECURITY_HEADERS = createSecurityHeaders();
  const headerEntries = Object.entries(SECURITY_HEADERS);

  return async (c, next) => {
    await next();

    // レスポンスにセキュリティヘッダーを追加
    for (const [key, value] of headerEntries) {
      c.header(key, value);
    }
  };
};
