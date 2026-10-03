import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { EmbeddingBackfillOutcome } from "../lib/embeddingBackfillOutcome";

/**
 * 同期エラーが起きた処理。再試行は同じ処理をやり直す
 * - initial: 初回同期（sync）
 * - more: 追加取得（syncMore）
 * - all: 同期期間の論文をすべて取得（syncAll）
 * - from-date: 指定日以前の取得（syncFromDate）。date に取得対象の終了日を持つ
 */
export type SyncErrorSource =
  | { kind: "initial" }
  | { kind: "more" }
  | { kind: "all" }
  | { kind: "from-date"; date: string };

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
  /** 少ない日クリック時の遡り同期を実行中か */
  isSyncingFromDate: boolean;
  /** 少ない日クリック時の取得対象終了日 */
  syncFromDateTarget: string | null;
  /** Embedding バックフィル実行中か */
  isEmbeddingBackfilling: boolean;
  /** Embedding バックフィル進捗 */
  embeddingBackfillProgress: { completed: number; total: number } | null;
  /** 直近の Embedding バックフィルの結果（次の実行開始・閉じる操作まで保持） */
  embeddingBackfillOutcome: EmbeddingBackfillOutcome | null;
  /** 直近の同期エラー（429 時は SyncRateLimitError） */
  lastSyncError: Error | null;
  /** lastSyncError が起きた処理（再試行で同じ処理をやり直すため） */
  lastSyncErrorSource: SyncErrorSource | null;
  /** 初回同期の結果をストアへ保存中の件数（取得完了から論文が一覧に出るまで。並行保存に備えて数える） */
  savingSyncedPapersCount: number;
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
  setIsSyncingFromDate: (value: boolean) => void;
  setSyncFromDateTarget: (target: string | null) => void;
  setIsEmbeddingBackfilling: (value: boolean) => void;
  setEmbeddingBackfillProgress: (
    progress: {
      completed: number;
      total: number;
    } | null
  ) => void;
  setEmbeddingBackfillOutcome: (outcome: EmbeddingBackfillOutcome | null) => void;
  /** エラーと発生元を記録する。null を渡すと発生元も消える */
  setLastSyncError: (error: Error | null, source?: SyncErrorSource) => void;
  beginSavingSyncedPapers: () => void;
  endSavingSyncedPapers: () => void;
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
  isSyncingFromDate: false,
  syncFromDateTarget: null,
  isEmbeddingBackfilling: false,
  embeddingBackfillProgress: null,
  embeddingBackfillOutcome: null,
  lastSyncError: null,
  lastSyncErrorSource: null,
  savingSyncedPapersCount: 0,
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
      setIsSyncingFromDate: (value) => set({ isSyncingFromDate: value }),
      setSyncFromDateTarget: (target) => set({ syncFromDateTarget: target }),
      setIsEmbeddingBackfilling: (value) => set({ isEmbeddingBackfilling: value }),
      setEmbeddingBackfillProgress: (progress) => set({ embeddingBackfillProgress: progress }),
      setEmbeddingBackfillOutcome: (outcome) => set({ embeddingBackfillOutcome: outcome }),
      setLastSyncError: (error, source) =>
        set({ lastSyncError: error, lastSyncErrorSource: error ? (source ?? null) : null }),
      beginSavingSyncedPapers: () =>
        set((s) => ({ savingSyncedPapersCount: s.savingSyncedPapersCount + 1 })),
      endSavingSyncedPapers: () =>
        set((s) => ({ savingSyncedPapersCount: Math.max(0, s.savingSyncedPapersCount - 1) })),
      reset: () => set(initialState),
    }),
    { name: "sync-store" }
  )
);
