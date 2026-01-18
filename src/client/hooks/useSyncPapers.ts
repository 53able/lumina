import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { syncApi } from "@/client/lib/api";
import { usePaperStore } from "@/client/stores/paperStore";
import { useSettingsStore } from "@/client/stores/settingsStore";
import type { SyncResponse } from "@/shared/schemas";

/** キャッシュの有効期間（5分） */
const SYNC_STALE_TIME = 5 * 60 * 1000;

/**
 * 同期APIの入力パラメータ
 */
interface SyncParams {
  /** 同期対象のカテゴリ */
  categories: string[];
  /** 同期期間（日数） */
  period?: "7" | "30" | "90" | "180" | "365";
  /** OpenAI APIキー（オプション） */
  apiKey?: string;
}

/**
 * クエリキーを生成する
 * @param params - 同期パラメータ
 * @returns クエリキー配列
 */
const createSyncQueryKey = (params: SyncParams) =>
  ["sync", params.categories.sort().join(","), params.period ?? "30"] as const;

/**
 * useSyncPapers - 論文同期用のフック（5分キャッシュ付き）
 *
 * React Query の useQuery を使用して5分間のキャッシュを実現:
 * - 同じパラメータで5分以内に再実行 → キャッシュを返す
 * - 5分経過後、またはパラメータ変更 → APIを叩く
 * - ローディング状態の自動管理
 * - 成功時のZustandストア更新
 *
 * @param params - 同期パラメータ（categories, period, apiKey）
 * @param options - コールバックオプション
 * @returns { sync, isSyncing, error } - 同期関数と状態
 *
 * @example
 * ```tsx
 * const { sync, isSyncing, error } = useSyncPapers(
 *   { categories: ["cs.AI"], period: "30" },
 *   { onError: (err) => console.error(err) }
 * );
 *
 * // ボタン押下時に実行
 * <SyncButton isSyncing={isSyncing} onSync={sync} />
 * ```
 */
export const useSyncPapers = (
  params: SyncParams,
  options?: {
    onSuccess?: (data: SyncResponse) => void;
    onError?: (error: Error) => void;
  }
) => {
  const { addPapers, papers: storePapers } = usePaperStore();
  const { setLastSyncedAt } = useSettingsStore();
  const queryClient = useQueryClient();

  // コールバックをrefで安定化（依存配列での無限ループを防ぐ）
  const onSuccessRef = useRef(options?.onSuccess);
  const onErrorRef = useRef(options?.onError);
  onSuccessRef.current = options?.onSuccess;
  onErrorRef.current = options?.onError;

  // ページング状態
  const [nextStart, setNextStart] = useState(0);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // 同期フラグ（レースコンディション防止用）
  // useState は非同期バッチ更新のため、連続呼び出しを防げない
  const isLoadingMoreRef = useRef(false);

  const queryKey = createSyncQueryKey(params);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<SyncResponse> => {
      const response = await syncApi(
        {
          categories: params.categories,
          period: params.period,
          start: 0, // 初回は常に0から
        },
        { apiKey: params.apiKey }
      );
      return response;
    },
    enabled: false, // 自動実行しない（手動でrefetch）
    staleTime: SYNC_STALE_TIME, // 5分間キャッシュ
    gcTime: SYNC_STALE_TIME, // キャッシュ保持期間も5分
  });

  // 成功時の処理（dataが変わったとき）
  useEffect(() => {
    if (data && data.papers.length > 0) {
      addPapers(data.papers);
      setNextStart(data.fetchedCount);
      setTotalResults(data.totalResults);
      setLastSyncedAt(new Date()); // 最終同期日時を更新
      onSuccessRef.current?.(data);
    }
  }, [data, addPapers, setLastSyncedAt]);

  // エラー時の処理
  useEffect(() => {
    if (error) {
      onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
    }
  }, [error]);

  // 同期実行関数（最初から取得）
  const sync = useCallback(() => {
    // キャッシュが新鮮（5分以内）かチェック
    const cachedData = queryClient.getQueryData<SyncResponse>(queryKey);
    const queryState = queryClient.getQueryState(queryKey);
    const isStale =
      !queryState?.dataUpdatedAt || Date.now() - queryState.dataUpdatedAt > SYNC_STALE_TIME;

    if (cachedData && !isStale) {
      // キャッシュが有効 → 再利用（APIを叩かない）
      console.log("[useSyncPapers] Using cached data (within 5 min)");
      // 成功コールバックを呼ぶ
      if (cachedData.papers.length > 0) {
        addPapers(cachedData.papers);
      }
      setNextStart(cachedData.fetchedCount);
      setTotalResults(cachedData.totalResults);
      onSuccessRef.current?.(cachedData);
      return;
    }

    // キャッシュが古いか存在しない → APIを叩く
    console.log("[useSyncPapers] Fetching fresh data from API");
    setNextStart(0);
    setTotalResults(null);
    refetch();
  }, [queryClient, queryKey, addPapers, refetch]);

  // 追加同期実行関数（次のページを取得）
  const syncMore = useCallback(async () => {
    // useRef で同期的にチェック（レースコンディション防止）
    // useState の setIsLoadingMore(true) は React のバッチ更新で遅延するため、
    // IntersectionObserver の連続発火を防げない
    if (isLoadingMoreRef.current) {
      console.log("[useSyncPapers] syncMore already in progress, skipping");
      return;
    }

    // ストアに論文があるがnextStartが0の場合、ストアの件数を起点にする
    // （初回syncなしでsyncMoreが呼ばれた場合の対策）
    const effectiveStart =
      nextStart === 0 && storePapers.length > 0 ? storePapers.length : nextStart;

    if (totalResults !== null && effectiveStart >= totalResults) {
      console.log("[useSyncPapers] No more papers to fetch");
      return;
    }

    // 同期フラグを即座に立てる（レースコンディション防止）
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true); // UI更新用
    console.log(`[useSyncPapers] Fetching more papers from start=${effectiveStart}`);

    try {
      const response = await syncApi(
        {
          categories: params.categories,
          period: params.period,
          start: effectiveStart,
        },
        { apiKey: params.apiKey }
      );

      if (response.papers.length > 0) {
        addPapers(response.papers);
        // effectiveStartを基準に次の開始位置を設定
        setNextStart(effectiveStart + response.fetchedCount);
        setTotalResults(response.totalResults);
        setLastSyncedAt(new Date()); // 最終同期日時を更新
        onSuccessRef.current?.(response);
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [totalResults, nextStart, storePapers.length, params, addPapers, setLastSyncedAt]);

  // まだ論文があるかどうか
  const hasMore = totalResults === null || nextStart < totalResults;

  return {
    /** 同期を実行する関数（最初から取得） */
    sync,
    /** 追加同期を実行する関数（次のページを取得） */
    syncMore,
    /** 同期中かどうか */
    isSyncing: isFetching || isLoadingMore,
    /** まだ論文があるかどうか */
    hasMore,
    /** 全件数 */
    totalResults,
    /** エラー */
    error: error instanceof Error ? error : null,
  };
};
