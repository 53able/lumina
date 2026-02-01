import { RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useSyncStore } from "../stores/syncStore";
import { Button } from "./ui/button";

/**
 * SyncButton Props
 */
interface SyncButtonProps {
  /** 同期中フラグ（React Query の isPending を渡す） */
  isSyncing: boolean;
  /** 同期処理を実行する関数 */
  onSync: () => void;
}

/**
 * SyncButton - arXiv論文同期ボタン
 *
 * React Query の useMutation と連携して使用する。
 * ローディング状態は外部から isPending を渡すことで制御される。
 * 順次取得（バックグラウンド同期）の状態も syncStore から自動的に取得して表示する。
 *
 * @example
 * ```tsx
 * const { mutate, isPending } = useSyncPapers();
 * <SyncButton isSyncing={isPending} onSync={() => mutate({ categories })} />
 * ```
 */
export const SyncButton: FC<SyncButtonProps> = ({ isSyncing, onSync }) => {
  // 順次取得（バックグラウンド同期）の状態を取得
  const { isIncrementalSyncing, progress } = useSyncStore();

  // いずれかの同期が実行中かどうか
  const isAnySyncing = isSyncing || isIncrementalSyncing;

  // 表示テキストを決定
  const getButtonText = (): string => {
    if (isIncrementalSyncing && progress) {
      // 順次取得中で進捗情報がある場合（今回の実行で取得した件数を表示）
      const count = progress.fetchedThisRun;
      if (progress.total > 0) {
        return `同期中 (${count}/${progress.total})`;
      }
      return `同期中 (${count}件)`;
    }
    if (isAnySyncing) {
      return "同期中";
    }
    return "同期";
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSync}
      disabled={isAnySyncing}
      aria-label={isAnySyncing ? "同期中" : "同期"}
    >
      <RefreshCw className={isAnySyncing ? "animate-spin" : ""} />
      {getButtonText()}
    </Button>
  );
};
