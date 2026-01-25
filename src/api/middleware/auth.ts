import type { MiddlewareHandler } from "hono";
import type { Env } from "../types/env";

/**
 * Basic認証ミドルウェアの作成
 */
export const createAuthMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const expectedUsername = c.env?.BASIC_AUTH_USERNAME ?? "admin";
    const expectedPassword = c.env?.BASIC_AUTH_PASSWORD ?? "admin";

    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="Lumina API"');
      return c.text("Unauthorized", 401);
    }

    try {
      const base64Credentials = authHeader.slice(6);
      // Edge Runtime / Browser 互換の方法でデコード
      const decoded = atob(base64Credentials);
      const [username, password] = decoded.split(":");

      if (username === expectedUsername && password === expectedPassword) {
        await next();
      } else {
        c.header("WWW-Authenticate", 'Basic realm="Lumina API"');
        return c.text("Unauthorized", 401);
      }
    } catch {
      c.header("WWW-Authenticate", 'Basic realm="Lumina API"');
      return c.text("Unauthorized", 401);
    }
  };
};
