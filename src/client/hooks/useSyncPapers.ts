import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, SyncResponse } from "../../shared/schemas/index";
import { normalizeDate, now, timestamp } from "../../shared/utils/dateTime";
import { getDecryptedApiKey, syncApi } from "../lib/api";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSyncStore } from "../stores/syncStore";

/**
 * APIレスポンスの論文データを正規化（日付文字列をDateオブジェクトに変換）
 *
 * Hono RPC の型推論では Date として扱われるが、
 * 実際の JSON レスポンスでは ISO 文字列として返ってくるため変換が必要
 */
const normalizePaper = (paper: {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  publishedAt: string | Date;
  updatedAt: string | Date;
  pdfUrl: string;
  arxivUrl: string;
  embedding?: number[];
}): Paper => ({
  ...paper,
  publishedAt: normalizeDate(paper.publishedAt),
  updatedAt: normalizeDate(paper.updatedAt),
});

/**
 * APIレスポンスを正規化（論文データの日付変換）
 */
const normalizeSyncResponse = (response: {
  papers: Array<{
    id: string;
    title: string;
    abstract: string;
    authors: string[];
    categories: string[];
    publishedAt: string | Date;
    updatedAt: string | Date;
    pdfUrl: string;
    arxivUrl: string;
    embedding?: number[];
  }>;
  fetchedCount: number;
  totalResults: number;
  took: number;
}): SyncResponse => ({
  ...response,
  papers: response.papers.map(normalizePaper),
});

/** キャッシュの有効期間（5分） */
const SYNC_STALE_TIME = 5 * 60 * 1000;

/** レートリミット: 100リクエスト/15分 */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15分
const RATE_LIMIT_MAX_REQUESTS = 100;
/** 安全マージンを考慮した1リクエストあたりの待機時間（ミリ秒） */
const RATE_LIMIT_DELAY_MS = Math.ceil((RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_REQUESTS) * 1.1); // 約10秒

/**
 * 同期APIの入力パラメータ
 */
interface SyncParams {
  /** 同期対象のカテゴリ */
  categories: string[];
  /** 同期期間（日数） */
  period?: "7" | "30" | "90" | "180" | "365";
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
  const {
    startIncrementalSync,
    updateProgress,
    completeIncrementalSync,
    errorIncrementalSync,
  } = useSyncStore();
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
  // レートリミット管理: 最後のリクエスト時刻を記録
  const lastRequestTimeRef = useRef<number>(0);

  /**
   * レートリミットを考慮して待機する
   * 最後のリクエストから一定時間経過するまで待機
   */
  const waitForRateLimitRef = useRef(async (): Promise<void> => {
    const now = timestamp();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;

    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
      console.log(`[useSyncPapers] Rate limit: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    lastRequestTimeRef.current = timestamp();
  });

  const queryKey = createSyncQueryKey(params);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<SyncResponse> => {
      // API key を復号化して取得
      const apiKey = await getDecryptedApiKey();

      const response = await syncApi(
        {
          categories: params.categories,
          period: params.period,
          start: 0, // 初回は常に0から
        },
        { apiKey }
      );
      // 日付文字列を Date オブジェクトに正規化
      return normalizeSyncResponse(response);
    },
    enabled: false, // 自動実行しない（手動でrefetch）
    staleTime: SYNC_STALE_TIME, // 5分間キャッシュ
    gcTime: SYNC_STALE_TIME, // キャッシュ保持期間も5分
  });

  // 成功時の処理（dataが変わったとき）
  useEffect(() => {
    if (data && data.papers.length > 0) {
      // DBに既に存在する論文をスキップ
      const existingPaperIds = new Set(storePapers.map((p) => p.id));
      const newPapers = data.papers.filter((p) => !existingPaperIds.has(p.id));

      if (newPapers.length > 0) {
        addPapers(newPapers);
      }
      setNextStart(data.fetchedCount);
      setTotalResults(data.totalResults);
      setLastSyncedAt(now()); // 最終同期日時を更新
      onSuccessRef.current?.(data);
    }
  }, [data, addPapers, setLastSyncedAt, storePapers]);

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
      !queryState?.dataUpdatedAt || timestamp() - queryState.dataUpdatedAt > SYNC_STALE_TIME;

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
      // レートリミットを考慮して待機
      await waitForRateLimitRef.current();

      // API key を復号化して取得
      const apiKey = await getDecryptedApiKey();

      const rawResponse = await syncApi(
        {
          categories: params.categories,
          period: params.period,
          start: effectiveStart,
        },
        { apiKey }
      );
      // 日付文字列を Date オブジェクトに正規化
      const response = normalizeSyncResponse(rawResponse);

      if (response.papers.length > 0) {
        // DBに既に存在する論文をスキップ
        const existingPaperIds = new Set(storePapers.map((p) => p.id));
        const newPapers = response.papers.filter((p) => !existingPaperIds.has(p.id));

        if (newPapers.length > 0) {
          addPapers(newPapers);
        }
        // effectiveStartを基準に次の開始位置を設定
        setNextStart(effectiveStart + response.fetchedCount);
        setTotalResults(response.totalResults);
        setLastSyncedAt(now()); // 最終同期日時を更新
        onSuccessRef.current?.(response);
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [totalResults, nextStart, storePapers, params, addPapers, setLastSyncedAt]);

  /**
   * 同期期間内の未取得論文を順次取得する（バックグラウンド実行）
   * レートリミットを考慮しながら、全ての論文を取得するまで繰り返す
   *
   * @param onProgress 進捗コールバック（取得した論文数、残り件数など）- オプショナル、syncStoreでも管理される
   * @param onComplete 完了コールバック - オプショナル
   * @param onError エラーコールバック - オプショナル
   * @returns 中断用のAbortController
   */
  const syncIncremental = useCallback(
    async (
      onProgress?: (progress: { fetched: number; remaining: number; total: number }) => void,
      onComplete?: () => void,
      onError?: (error: Error) => void
    ): Promise<AbortController> => {
      const abortController = new AbortController();
      const existingPaperIds = new Set(storePapers.map((p) => p.id));
      let currentStart = 0;
      let totalRemaining: number | null = null;

      // syncStoreで状態を開始
      startIncrementalSync(abortController);

      const fetchNextBatch = async (): Promise<void> => {
        if (abortController.signal.aborted) {
          console.log("[useSyncPapers] Incremental sync aborted");
          completeIncrementalSync();
          return;
        }

        try {
          // レートリミットを考慮して待機
          await waitForRateLimitRef.current();

          // API key を復号化して取得
          const apiKey = await getDecryptedApiKey();

          const rawResponse = await syncApi(
            {
              categories: params.categories,
              period: params.period,
              start: currentStart,
              maxResults: 50, // 1回あたりの最大取得件数
            },
            { apiKey }
          );

          const response = normalizeSyncResponse(rawResponse);
          totalRemaining = response.totalResults;

          if (response.papers.length === 0) {
            // これ以上取得する論文がない
            console.log("[useSyncPapers] Incremental sync completed: no more papers");
            completeIncrementalSync();
            onComplete?.();
            return;
          }

          // DBに既に存在する論文をスキップ
          const newPapers = response.papers.filter((p) => !existingPaperIds.has(p.id));

          if (newPapers.length > 0) {
            addPapers(newPapers);
            // 既存のIDセットを更新（次回のフィルタリング用）
            for (const paper of newPapers) {
              existingPaperIds.add(paper.id);
            }
          }

          // 次のバッチの開始位置を更新（処理済み件数をカウント）
          currentStart += response.fetchedCount;

          // 進捗を通知（syncStoreとコールバックの両方に通知）
          // fetched: 処理済み件数（既存論文のスキップも含む）
          // remaining: 残り件数
          // total: 全件数
          const processedCount = currentStart; // 処理済み件数
          const remaining = Math.max(0, totalRemaining - processedCount);
          const progressData = {
            fetched: processedCount,
            remaining,
            total: totalRemaining,
          };
          updateProgress(progressData);
          onProgress?.(progressData);

          // まだ取得する論文があるかチェック
          if (currentStart >= totalRemaining) {
            console.log("[useSyncPapers] Incremental sync completed: all papers fetched");
            setLastSyncedAt(now());
            completeIncrementalSync();
            onComplete?.();
            return;
          }

          // 次のバッチを取得（再帰的に呼び出す）
          await fetchNextBatch();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("[useSyncPapers] Incremental sync error:", error);
          errorIncrementalSync();
          onError?.(error);
          onErrorRef.current?.(error);
        }
      };

      // 非同期で実行開始
      fetchNextBatch().catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[useSyncPapers] Incremental sync fatal error:", error);
        errorIncrementalSync();
        onError?.(error);
        onErrorRef.current?.(error);
      });

      return abortController;
    },
    [
      storePapers,
      params,
      addPapers,
      setLastSyncedAt,
      startIncrementalSync,
      updateProgress,
      completeIncrementalSync,
      errorIncrementalSync,
    ]
  );

  // まだ論文があるかどうか
  const hasMore = totalResults === null || nextStart < totalResults;

  return {
    /** 同期を実行する関数（最初から取得） */
    sync,
    /** 追加同期を実行する関数（次のページを取得） */
    syncMore,
    /** 同期期間内の未取得論文を順次取得する関数（バックグラウンド実行） */
    syncIncremental,
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
