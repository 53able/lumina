import { AlertCircle, Loader2 } from "lucide-react";
import type { FC } from "react";
import { usePaperStore } from "../stores/paperStore";
import { Button } from "./ui/button";

/** 件数の表示（桁区切り） */
const formatCount = (count: number): string => count.toLocaleString("ja-JP");

/**
 * PaperLoadStatus - 保存済み論文の読み込み状態
 *
 * - 読み込み中: 読み込み済み件数 / 総件数を表示する（一覧のスクロール・入力は妨げない）
 * - 失敗: 理由と「再試行」を表示する
 * - 完了: 何も表示しない
 */
export const PaperLoadStatus: FC = () => {
  const loadStatus = usePaperStore((s) => s.loadStatus);
  const loadedCount = usePaperStore((s) => s.loadedCount);
  const totalCount = usePaperStore((s) => s.totalCount);
  const loadError = usePaperStore((s) => s.loadError);
  const retryLoad = usePaperStore((s) => s.retryLoad);

  if (loadStatus === "loading") {
    return (
      <output
        data-testid="paper-load-status"
        data-status="loading"
        aria-live="polite"
        className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        <span>
          保存済みの論文を読み込み中
          {totalCount !== null
            ? ` ${formatCount(loadedCount)} / ${formatCount(totalCount)} 件`
            : "..."}
        </span>
      </output>
    );
  }

  if (loadStatus === "error") {
    return (
      <div
        data-testid="paper-load-status"
        data-status="error"
        role="alert"
        className="mb-3 flex flex-wrap items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-bold">保存済みの論文を読み込めませんでした</p>
          {loadError ? (
            <p className="break-all text-xs text-muted-foreground">詳細: {loadError.message}</p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void retryLoad()}
          className="min-h-[44px] h-auto px-3 py-2"
        >
          再試行
        </Button>
      </div>
    );
  }

  return null;
};
