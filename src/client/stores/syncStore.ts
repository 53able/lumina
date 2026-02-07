import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * syncStore の状態型
 *
 * 同期の UI/プロセス状態のみを保持する（永続化しない）。
 * useSyncPapers が更新し、SyncStatusBar / PaperList / PaperExplorer が購読する。
 */
interface SyncState {
  /** 取得済み範囲 [start, end) の配列（ギャップ補填用） */
  requestedRanges: [number, number][];
  /** 同期 API の totalResults */
  totalResults: number | null;
  /** 追加取得（syncMore）中か */
  isLoadingMore: boolean;
  /** 初回 sync / refetch 中（React Query の isFetching を同期） */
  isFetching: boolean;
  /** 同期期間の論文をすべて取得中か */
  isSyncingAll: boolean;
  /** 全件取得の進捗（取得済み / 全件数） */
  syncAllProgress: { fetched: number; total: number } | null;
  /** Embedding バックフィル実行中か */
  isEmbeddingBackfilling: boolean;
  /** Embedding バックフィル進捗 */
  embeddingBackfillProgress: { completed: number; total: number } | null;
  /** 直近の同期エラー（429 時は SyncRateLimitError） */
  lastSyncError: Error | null;
}

/**
 * syncStore のアクション型
 */
interface SyncActions {
  setRequestedRanges: (ranges: [number, number][]) => void;
  setTotalResults: (total: number | null) => void;
  setIsLoadingMore: (value: boolean) => void;
  setIsFetching: (value: boolean) => void;
  setIsSyncingAll: (value: boolean) => void;
  setSyncAllProgress: (progress: { fetched: number; total: number } | null) => void;
  setIsEmbeddingBackfilling: (value: boolean) => void;
  setEmbeddingBackfillProgress: (
    progress: {
      completed: number;
      total: number;
    } | null
  ) => void;
  setLastSyncError: (error: Error | null) => void;
  /** すべての同期状態を初期値に戻す */
  reset: () => void;
}

type SyncStore = SyncState & SyncActions;

const initialState: SyncState = {
  requestedRanges: [],
  totalResults: null,
  isLoadingMore: false,
  isFetching: false,
  isSyncingAll: false,
  syncAllProgress: null,
  isEmbeddingBackfilling: false,
  embeddingBackfillProgress: null,
  lastSyncError: null,
};

/**
 * syncStore - 同期の UI/プロセス状態
 *
 * Zustand + devtools。永続化しない。
 */
export const useSyncStore = create<SyncStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setRequestedRanges: (ranges) => set({ requestedRanges: ranges }),
      setTotalResults: (total) => set({ totalResults: total }),
      setIsLoadingMore: (value) => set({ isLoadingMore: value }),
      setIsFetching: (value) => set({ isFetching: value }),
      setIsSyncingAll: (value) => set({ isSyncingAll: value }),
      setSyncAllProgress: (progress) => set({ syncAllProgress: progress }),
      setIsEmbeddingBackfilling: (value) => set({ isEmbeddingBackfilling: value }),
      setEmbeddingBackfillProgress: (progress) => set({ embeddingBackfillProgress: progress }),
      setLastSyncError: (error) => set({ lastSyncError: error }),
      reset: () => set(initialState),
    }),
    { name: "sync-store" }
  )
);
