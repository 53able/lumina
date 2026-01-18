import type { MiddlewareHandler } from "hono";

/**
 * Basic認証ミドルウェアの作成
 * 環境変数から認証情報を取得し、未設定の場合はデフォルト値を使用
 */
export const createAuthMiddleware = (): MiddlewareHandler => {
  const expectedUsername = process.env.BASIC_AUTH_USERNAME ?? "admin";
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD ?? "admin";

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="Lumina API"');
      return c.text("Unauthorized", 401);
    }

    try {
      const base64Credentials = authHeader.slice(6);
      const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
      const [username, password] = credentials.split(":");

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
