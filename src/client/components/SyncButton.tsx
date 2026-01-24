import { RefreshCw } from "lucide-react";
import type { FC } from "react";
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
 *
 * @example
 * ```tsx
 * const { mutate, isPending } = useSyncPapers();
 * <SyncButton isSyncing={isPending} onSync={() => mutate({ categories })} />
 * ```
 */
export const SyncButton: FC<SyncButtonProps> = ({ isSyncing, onSync }) => {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onSync}
      disabled={isSyncing}
      aria-label={isSyncing ? "同期中" : "同期"}
    >
      <RefreshCw className={isSyncing ? "animate-spin" : ""} />
      {isSyncing ? "同期中" : "同期"}
    </Button>
  );
};
