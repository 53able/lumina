import { toast } from "sonner";
import { ApiDisabledError } from "./api";

/**
 * 要約APIが工程別の失敗として返す分類（上流のエラー文は返さない）
 * - rate_limit: 429（待って再試行）
 * - auth: キー未設定・401/403（設定を直す）
 * - invalid_output: AIの出力を解釈できない（再試行）
 * - upstream: その他の上流エラー（再試行）
 */
export type SummaryStageErrorCode = "rate_limit" | "auth" | "invalid_output" | "upstream";

const STAGE_ERROR_CODES: readonly SummaryStageErrorCode[] = [
  "rate_limit",
  "auth",
  "invalid_output",
  "upstream",
];

/** 分類ごとの案内（利用者向けの文言はクライアントで決める） */
const STAGE_ERROR_GUIDANCE: Record<SummaryStageErrorCode, string> = {
  rate_limit: "AIの利用上限に達しました。時間をおいて再試行してください。",
  auth: "APIキーの設定を確認してください。",
  invalid_output: "AIの出力を読み取れませんでした。再試行してください。",
  upstream: "AIサービスでエラーが発生しました。再試行してください。",
};

/** 応答の code を既知の分類へ絞り込む（未知の値は upstream として扱う） */
export const toSummaryStageErrorCode = (code: unknown): SummaryStageErrorCode =>
  STAGE_ERROR_CODES.find((known) => known === code) ?? "upstream";

/**
 * 要約は保存できたが、説明文の生成だけが失敗したことを表すエラー
 *
 * 再試行では説明文だけを生成する（generateTarget: "explanation"）。要約は再生成しない。
 */
export class PartialSummaryError extends Error {
  /** 失敗した工程 */
  readonly failedStage = "explanation";
  /** 失敗の分類 */
  readonly code: SummaryStageErrorCode;
  /** 再試行で解決しうるか */
  readonly retryable: boolean;

  constructor(code: SummaryStageErrorCode, retryable: boolean) {
    super(`要約は保存しました。${STAGE_ERROR_GUIDANCE[code]}`);
    this.name = "PartialSummaryError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 要約生成の失敗をトーストで知らせる
 * - 部分成功（要約は保存済み）は警告として出し、失敗と区別する
 * - API利用OFFは停止中であることを見出しで示す
 * @param title - 失敗した論文のタイトル（生成中に別の論文へ移動している場合があるため添える）
 */
export const showSummaryErrorToast = (err: Error, title: string | undefined): void => {
  if (err instanceof PartialSummaryError) {
    toast.warning("説明文を生成できませんでした", {
      description: title ? `${title}: ${err.message}` : err.message,
    });
    return;
  }
  toast.error(err instanceof ApiDisabledError ? "AI要約を停止中" : "要約生成エラー", {
    description: title ? `${title}: ${err.message}` : err.message,
  });
};
