/**
 * 自前のエラー型
 * logger.ts が services を import せずに instanceof で判定できるよう、ここにまとめる。
 * 元のモジュール（services/arxivFetcher.ts、services/openai.ts）からも re-export している
 */

/**
 * arXiv API が 429 (Too Many Requests) を返したときに投げるエラー。
 * sync ルートで 429 としてクライアントに返し、クライアントのリトライを促す。
 */
export class ArxivRateLimitError extends Error {
  constructor(
    message: string,
    /** Retry-After 秒数（arXiv のヘッダーから。無い場合は undefined） */
    public readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "ArxivRateLimitError";
  }
}

/**
 * arXiv API が 502/503/504 を返したとき、またはタイムアウト・ネットワーク失敗のときに投げるエラー。
 * sync ルートで 503 として返し、クライアントがリトライできるようにする。
 * ネットワーク失敗では元のエラーを cause に入れる（ログで ECONNRESET などを取るため）
 */
export class ArxivServiceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArxivServiceUnavailableError";
  }
}

/**
 * arXiv API が 429・502〜504 以外の失敗ステータスを返したときに投げるエラー。
 * message は arXiv の公開テキストなのでログに出してよい
 */
export class ArxivHttpError extends Error {
  constructor(
    message: string,
    /** arXiv が返した HTTP ステータス */
    public readonly status: number
  ) {
    super(message);
    this.name = "ArxivHttpError";
  }
}

/**
 * OpenAI APIキーが設定されていないときに getOpenAIConfig が投げるエラー
 */
export class OpenAIApiKeyNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIApiKeyNotConfiguredError";
  }
}
