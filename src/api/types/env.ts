/**
 * Hono アプリケーションで使用する環境変数の型定義
 */
export interface Env {
  /** OpenAI APIキー */
  OPENAI_API_KEY: string;
  /** Basic認証のユーザー名 */
  BASIC_AUTH_USERNAME?: string;
  /** Basic認証のパスワード */
  BASIC_AUTH_PASSWORD?: string;
  /** Node環境 */
  NODE_ENV?: string;
  /** その他のVercel環境変数 */
  [key: string]: unknown;
}
