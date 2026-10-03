/**
 * Embedding 補完の結果（成功／部分成功／失敗）と、失敗理由に応じた次の操作の案内を組み立てる。
 *
 * 補完欄の近くに持続表示し、トースト消失後も「なぜ論文が検索対象にならないか」
 * 「待つ・設定を直す・再試行する」のどれを選べばよいかを判断できるようにする。
 */
import { EmbeddingApiError, EmbeddingRateLimitError } from "./api";

/** 失敗理由の分類 */
export type EmbeddingBackfillFailureKind = "rate_limit" | "auth" | "network" | "server" | "unknown";

/** 失敗理由と次の操作 */
export interface EmbeddingBackfillFailure {
  kind: EmbeddingBackfillFailureKind;
  /** 何が起きたか */
  reason: string;
  /** 次に何をすればよいか */
  guidance: string;
  /** 元のエラーメッセージ（サーバー・ネットワーク由来の詳細） */
  detail?: string;
}

/** 補完1回分の結果 */
export interface EmbeddingBackfillOutcome {
  status: "success" | "partial" | "failed";
  /** 保存できた件数 */
  completed: number;
  /** 補完対象だった件数 */
  total: number;
  /** status が success 以外のときの理由 */
  failure: EmbeddingBackfillFailure | null;
}

/** API キーが未設定のため補完を開始できないときのエラー */
export class EmbeddingApiKeyMissingError extends Error {
  constructor() {
    super("OpenAI APIキーが設定されていません");
    this.name = "EmbeddingApiKeyMissingError";
  }
}

const getStatus = (error: unknown): number | undefined => {
  if (error instanceof EmbeddingRateLimitError) return error.status;
  if (error instanceof EmbeddingApiError) return error.status;
  return undefined;
};

/**
 * エラーを失敗理由へ分類する
 *
 * - 429: 待機して再試行
 * - 401/403・キー未設定・キー復号失敗: 設定を修正
 * - fetch 失敗（TypeError）: 接続を確認して再試行
 * - 5xx: 時間をおいて再試行
 *
 * @param error 捕捉した値（DOMException は環境により Error を継承しないため unknown で受ける）
 */
export const classifyEmbeddingBackfillError = (error: unknown): EmbeddingBackfillFailure => {
  const status = getStatus(error);
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);

  if (status === 429) {
    return {
      kind: "rate_limit",
      reason: "レート制限（429）のため取得を中断しました",
      guidance: "しばらく待ってから、未処理分を再試行してください。",
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    error instanceof EmbeddingApiKeyMissingError ||
    name === "OperationError"
  ) {
    return {
      kind: "auth",
      reason:
        error instanceof EmbeddingApiKeyMissingError
          ? "OpenAI APIキーが設定されていません"
          : "OpenAI APIキーを利用できませんでした（認証エラー）",
      guidance: "設定でAPIキーを確認・再登録してから、未処理分を再試行してください。",
      // 認証エラーの詳細には API キーの一部が含まれうるため画面に残さない
    };
  }

  if (error instanceof TypeError) {
    return {
      kind: "network",
      reason: "ネットワークに接続できませんでした",
      guidance: "接続を確認してから、未処理分を再試行してください。",
      detail: message,
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: "server",
      reason: `サーバーでエラーが発生しました（${status}）`,
      guidance: "時間をおいて、未処理分を再試行してください。",
      detail: message,
    };
  }

  return {
    kind: "unknown",
    reason: "Embeddingを取得できませんでした",
    guidance: "未処理分を再試行してください。解決しない場合は設定を確認してください。",
    detail: message,
  };
};

/**
 * 補完の進捗とエラーから結果を組み立てる
 *
 * @param completed 保存できた件数
 * @param total 補完対象だった件数
 * @param error 途中で発生したエラー（なければ null）
 */
export const createEmbeddingBackfillOutcome = (
  completed: number,
  total: number,
  error: unknown
): EmbeddingBackfillOutcome => {
  if (error == null && completed >= total) {
    return { status: "success", completed, total, failure: null };
  }

  const failure = error
    ? classifyEmbeddingBackfillError(error)
    : {
        kind: "unknown" as const,
        reason: "一部の論文のEmbeddingを取得できませんでした",
        guidance: "未処理分を再試行してください。",
      };

  return { status: completed > 0 ? "partial" : "failed", completed, total, failure };
};
