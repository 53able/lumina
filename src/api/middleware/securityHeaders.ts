import type { MiddlewareHandler } from "hono";
import type { Env } from "../types/env";

/**
 * セキュリティヘッダーの設定値
 */
const getSecurityHeaders = (isProd: boolean): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };

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
 */
export const createSecurityHeadersMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const isProd = c.env?.NODE_ENV === "production" || import.meta.env?.PROD === true;
    const securityHeaders = getSecurityHeaders(!!isProd);

    await next();

    // レスポンスにセキュリティヘッダーを追加
    for (const [key, value] of Object.entries(securityHeaders)) {
      c.header(key, value);
    }
  };
};
