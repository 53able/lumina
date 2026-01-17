import { basicAuth } from "hono/basic-auth";
/**
 * Basic認証ミドルウェアの作成
 * 環境変数から認証情報を取得し、未設定の場合はデフォルト値を使用
 */
export const createAuthMiddleware = () => {
    const username = process.env.BASIC_AUTH_USERNAME ?? "admin";
    const password = process.env.BASIC_AUTH_PASSWORD ?? "admin";
    return basicAuth({
        username,
        password,
        realm: "Lumina API",
    });
};
