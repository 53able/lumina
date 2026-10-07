import { toast } from "sonner";
import { ApiDisabledError, type GenerateTarget } from "./api";
import { PartialSummaryError, SummaryApiError } from "./summaryErrorTypes";

/**
 * 要約生成の失敗をトーストで知らせる
 * - API利用OFFは停止中であることを見出しで示す（最優先）
 * - 説明文の工程だけの失敗（部分成功、説明文のみの生成の失敗）は、要約は残っているため警告として出す
 * @param title - 失敗した論文のタイトル（生成中に別の論文へ移動している場合があるため添える）
 * @param target - 失敗した生成の対象
 * @param onOpenSettings - 設定を開く操作（残高不足のとき、トーストに「設定を開く」を出す。設定画面がない画面では渡さない）
 */
export const showSummaryErrorToast = (
  err: Error,
  title: string | undefined,
  target?: GenerateTarget,
  onOpenSettings?: () => void
): void => {
  const description = title ? `${title}: ${err.message}` : err.message;
  if (err instanceof ApiDisabledError) {
    toast.error("AI要約を停止中", { description });
    return;
  }
  // 残高不足は待っても解決しないため、設定への導線を添える（自動再試行はしない）
  const isQuota =
    (err instanceof SummaryApiError || err instanceof PartialSummaryError) && err.code === "quota";
  const action =
    isQuota && onOpenSettings ? { label: "設定を開く", onClick: onOpenSettings } : undefined;
  if (err instanceof PartialSummaryError || target === "explanation") {
    toast.warning("説明文を生成できませんでした", { description, action });
    return;
  }
  toast.error("要約生成エラー", { description, action });
};
