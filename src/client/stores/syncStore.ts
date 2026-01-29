import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * 同期進捗情報
 */
export interface SyncProgress {
  /** 取得済み論文数 */
  fetched: number;
  /** 残り論文数 */
  remaining: number;
  /** 全論文数 */
  total: number;
}

/**
 * syncStore の状態型
 *
 * @remarks
 * 同期の実行状態を管理するストア。
 * AbortControllerはシリアライズできないため、persistしない。
 */
interface SyncState {
  /** 順次取得が実行中かどうか */
  isIncrementalSyncing: boolean;
  /** 同期進捗情報 */
  progress: SyncProgress | null;
  /** 中断用のAbortController（シリアライズ不可のためpersistしない） */
  abortController: AbortController | null;
}

/**
 * syncStore のアクション型
 */
interface SyncActions {
  /** 順次取得を開始する */
  startIncrementalSync: (abortController: AbortController) => void;
  /** 順次取得の進捗を更新する */
  updateProgress: (progress: SyncProgress) => void;
  /** 順次取得を完了する */
  completeIncrementalSync: () => void;
  /** 順次取得を中断する */
  abortIncrementalSync: () => void;
  /** 順次取得でエラーが発生した */
  errorIncrementalSync: () => void;
}

type SyncStore = SyncState & SyncActions;

/**
 * syncStore - 同期実行状態の管理
 *
 * @remarks
 * 同期の実行状態をグローバルに管理するストア。
 * コンポーネントのライフサイクルに依存せず、状態を維持する。
 * AbortControllerはシリアライズできないため、persistしない。
 */
export const useSyncStore = create<SyncStore>()(
  devtools(
    (set, get) => ({
      // State（デフォルト値）
      isIncrementalSyncing: false,
      progress: null,
      abortController: null,

      // Actions

      startIncrementalSync: (abortController) => {
        set({
          isIncrementalSyncing: true,
          progress: { fetched: 0, remaining: 0, total: 0 },
          abortController,
        });
      },

      updateProgress: (progress) => {
        set({ progress });
      },

      completeIncrementalSync: () => {
        set({
          isIncrementalSyncing: false,
          progress: null,
          abortController: null,
        });
      },

      abortIncrementalSync: () => {
        const { abortController } = get();
        if (abortController) {
          abortController.abort();
        }
        set({
          isIncrementalSyncing: false,
          progress: null,
          abortController: null,
        });
      },

      errorIncrementalSync: () => {
        set({
          isIncrementalSyncing: false,
          progress: null,
          abortController: null,
        });
      },
    }),
    { name: "sync-store" }
  )
);
