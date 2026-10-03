import { toast } from "sonner";
import { ApiDisabledError, type GenerateTarget } from "./api";
import { PartialSummaryError } from "./summaryErrorTypes";

/**
 * 要約生成の失敗をトーストで知らせる
 * - API利用OFFは停止中であることを見出しで示す（最優先）
 * - 説明文の工程だけの失敗（部分成功、説明文のみの生成の失敗）は、要約は残っているため警告として出す
 * @param title - 失敗した論文のタイトル（生成中に別の論文へ移動している場合があるため添える）
 * @param target - 失敗した生成の対象
 */
export const showSummaryErrorToast = (
  err: Error,
  title: string | undefined,
  target?: GenerateTarget
): void => {
  const description = title ? `${title}: ${err.message}` : err.message;
  if (err instanceof ApiDisabledError) {
    toast.error("AI要約を停止中", { description });
    return;
  }
  if (err instanceof PartialSummaryError || target === "explanation") {
    toast.warning("説明文を生成できませんでした", { description });
    return;
  }
  toast.error("要約生成エラー", { description });
};
