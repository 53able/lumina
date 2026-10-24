import type { Logger } from "../lib/logger.js";

/**
 * Hono アプリケーションで使用する環境変数の型定義
 */
export interface Env {
  /** OpenAI APIキー */
  OPENAI_API_KEY: string;
  /** Node環境 */
  NODE_ENV?: string;
  /** その他のVercel環境変数 */
  [key: string]: unknown;
}

/**
 * ロガーを使うルートとアプリの環境型
 * Variables.logger は requestLogger ミドルウェアが設定する（reqId 付きの子ロガー）
 */
export type AppEnv = { Bindings: Env; Variables: { logger: Logger } };
