import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, SyncResponse } from "../../shared/schemas/index";
import { normalizeDate, now, timestamp } from "../../shared/utils/dateTime";
import { embeddingApi, embeddingBatchApi, getDecryptedApiKey, syncApi } from "../lib/api";
import { runBackfillEmbeddings } from "../lib/backfillEmbeddings";
import { getNextStartToRequest, mergeRanges } from "../lib/syncPagingUtils";
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

/** 順次取得: 1リクエストあたりの最大取得件数 */
const INCREMENTAL_BATCH_SIZE = 50;
/** syncMore の1リクエストあたりの取得件数（APIデフォルトと一致） */
const SYNC_MORE_BATCH_SIZE = 50;
/** 順次取得: 1ラウンドあたりの並列リクエスト数 */
const INCREMENTAL_PARALLEL_COUNT = 5;

/**
 * 同期期間ごとの「期間内として妥当な母数」の上限。
 * arXiv API は submittedDate 付きクエリでも totalResults を日付無視で返すことがあるため、
 * これを超える場合は表示用母数を 0（未確定）とする。
 */
const MAX_REASONABLE_TOTAL_BY_PERIOD: Record<string, number> = {
  "7": 10_000,
  "30": 30_000,
  "90": 80_000,
  "180": 150_000,
  "365": 300_000,
};

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
 * @returns { sync, isSyncing, isEmbeddingBackfilling, error } - 同期関数と状態（isSyncing は論文取得中のみ）
 *
 * @example
 * ```tsx
 * const { sync, isSyncing, isEmbeddingBackfilling, error } = useSyncPapers(
 *   { categories: ["cs.AI"], period: "30" },
 *   { onError: (err) => console.error(err) }
 * );
 *
 * // ボタン押下時に実行
 * <SyncButton isSyncing={isSyncing} onSync={sync} />
 * // Embedding 取得中は SyncStatusBar 等で isEmbeddingBackfilling を表示
 * ```
 */
export const useSyncPapers = (
  params: SyncParams,
  options?: {
    onSuccess?: (data: SyncResponse) => void;
    onError?: (error: Error) => void;
  }
) => {
  const { addPaper, addPapers, papers: storePapers } = usePaperStore();
  const { setLastSyncedAt } = useSettingsStore();
  const { startIncrementalSync, updateProgress, completeIncrementalSync, errorIncrementalSync } =
    useSyncStore();
  const queryClient = useQueryClient();

  // コールバックをrefで安定化（依存配列での無限ループを防ぐ）
  const onSuccessRef = useRef(options?.onSuccess);
  const onErrorRef = useRef(options?.onError);
  onSuccessRef.current = options?.onSuccess;
  onErrorRef.current = options?.onError;

  // ページング状態（取得済み範囲 [start, end) でギャップ補填に対応）
  const [requestedRanges, setRequestedRanges] = useState<[number, number][]>([]);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  /** Embedding バックフィル実行中（ボタン「同期中」表示用） */
  const [isEmbeddingBackfilling, setIsEmbeddingBackfilling] = useState(false);
  /** Embedding バックフィル進捗（取得中は「N/M件」表示用） */
  const [embeddingBackfillProgress, setEmbeddingBackfillProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  // 同期フラグ（レースコンディション防止用）
  // useState は非同期バッチ更新のため、連続呼び出しを防げない
  const isLoadingMoreRef = useRef(false);
  // レートリミット管理: 最後のリクエスト時刻を記録
  const lastRequestTimeRef = useRef<number>(0);
  /** effect 内で getState が使えない場合（テスト等）のフォールバック用。常に最新の storePapers を指す */
  const storePapersRef = useRef(storePapers);
  storePapersRef.current = storePapers;

  /**
   * レートリミットを考慮して待機する
   * 最後のリクエストから一定時間経過するまで待機
   */
  const waitForRateLimitRef = useRef(async (): Promise<void> => {
    const now = timestamp();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;

    if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
      const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    lastRequestTimeRef.current = timestamp();
  });

  const queryKey = createSyncQueryKey(params);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<SyncResponse> => {
      // API key を復号化して取得（早期開始パターン）
      const apiKeyPromise = getDecryptedApiKey();
      const apiKey = await apiKeyPromise;

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

  // 成功時の処理（data が変わったときのみ実行。storePapers を deps に含めないので addPaper で store が更新されても再実行されない）
  useEffect(() => {
    if (!data || data.papers.length === 0) return;

    const currentStorePapers =
      typeof usePaperStore.getState === "function"
        ? usePaperStore.getState().papers
        : storePapersRef.current;

    // DBに既に存在する論文をスキップ
    const existingPaperIds = new Set(currentStorePapers.map((p) => p.id));
    const newPapers = data.papers.filter((p) => !existingPaperIds.has(p.id));

    if (newPapers.length > 0) {
      addPapers(newPapers);
    }
    setRequestedRanges((prev) => mergeRanges([...prev, [0, data.fetchedCount]]));
    setTotalResults(data.totalResults);
    setLastSyncedAt(now()); // 最終同期日時を更新
    onSuccessRef.current?.(data);

    // Embedding 補完は同期ボタンから切り離し。手動で「Embeddingを補完」ボタンから実行する。
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
      !queryState?.dataUpdatedAt || timestamp() - queryState.dataUpdatedAt > SYNC_STALE_TIME;

    if (cachedData && !isStale) {
      // キャッシュが有効 → 再利用（APIを叩かない）
      // 成功コールバックを呼ぶ
      if (cachedData.papers.length > 0) {
        addPapers(cachedData.papers);
      }
      setRequestedRanges((prev) => mergeRanges([...prev, [0, cachedData.fetchedCount]]));
      setTotalResults(cachedData.totalResults);
      onSuccessRef.current?.(cachedData);
      return;
    }

    // キャッシュが古いか存在しない → APIを叩く
    setRequestedRanges([]);
    setTotalResults(null);
    refetch();
  }, [queryClient, queryKey, addPapers, refetch]);

  // 追加同期実行関数（次のページを取得）
  const syncMore = useCallback(async () => {
    // useRef で同期的にチェック（レースコンディション防止）
    // useState の setIsLoadingMore(true) は React のバッチ更新で遅延するため、
    // IntersectionObserver の連続発火を防げない
    if (isLoadingMoreRef.current) {
      return;
    }

    // 次にリクエストすべき start（ギャップがあればその先頭、なければ先頭の連続の次）
    const nextStartComputed = getNextStartToRequest(
      requestedRanges,
      totalResults ?? 0,
      SYNC_MORE_BATCH_SIZE
    );
    const effectiveStart =
      requestedRanges.length === 0 && storePapers.length > 0
        ? storePapers.length
        : nextStartComputed;

    if (totalResults !== null && effectiveStart >= totalResults) {
      return;
    }

    // 同期フラグを即座に立てる（レースコンディション防止）
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true); // UI更新用

    try {
      // レートリミットを考慮して待機
      await waitForRateLimitRef.current();

      // API key を復号化して取得（早期開始パターン）
      const apiKeyPromise = getDecryptedApiKey();
      const apiKey = await apiKeyPromise;

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
        setRequestedRanges((prev) =>
          mergeRanges([...prev, [effectiveStart, effectiveStart + response.fetchedCount]])
        );
        setTotalResults(response.totalResults);
        setLastSyncedAt(now());
        onSuccessRef.current?.(response);

        // Embedding 補完は同期ボタンから切り離し。手動で「Embeddingを補完」から実行する。
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [totalResults, requestedRanges, storePapers, params, addPapers, setLastSyncedAt]);

  /**
   * 同期期間内の未取得論文を順次取得する（バックグラウンド実行）
   * レートリミットを考慮しながら、全ての論文を取得するまで繰り返す。
   * 進捗の total は同期期間・選択カテゴリで絞った件数（API の totalResults）である。
   *
   * 契約: 開始オフセットは store 件数（既取得範囲をリクエストしない）。
   * addPapers に渡すのは API 返却のうち ID が既存でないもののみ（IndexedDB に新規のみ保存）。
   *
   * @param onProgress 進捗コールバック（fetched, remaining, total）。total は同期期間・カテゴリで絞った件数
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
      const initialStoreCount = storePapers.length;
      // 取得済み範囲をローカルで管理（ギャップ補填: ギャップがあればその先頭から取得）
      let localRanges: [number, number][] = [...requestedRanges];
      let totalRemaining: number | null = totalResults;

      // syncStoreで状態を開始
      startIncrementalSync(abortController);

      const fetchNextRound = async (): Promise<void> => {
        if (abortController.signal.aborted) {
          completeIncrementalSync();
          return;
        }

        try {
          // レートリミットを考慮して待機（1ラウンドに1回）
          await waitForRateLimitRef.current();

          // API key を復号化して取得（早期開始パターン）
          const apiKeyPromise = getDecryptedApiKey();
          const apiKey = await apiKeyPromise;

          // 次にリクエストすべき start（ギャップがあればその先頭、なければ先頭の連続の次）
          const currentStart =
            localRanges.length === 0 && initialStoreCount > 0
              ? initialStoreCount
              : getNextStartToRequest(
                  localRanges,
                  totalRemaining ?? Number.MAX_SAFE_INTEGER,
                  INCREMENTAL_BATCH_SIZE
                );

          // 50件×5並列: start = currentStart, currentStart+50, ... の5リクエストを同時に発行（period は必ず渡し、母数を同期期間・カテゴリで絞る）
          const effectivePeriod = params.period ?? "30";
          const requests = Array.from({ length: INCREMENTAL_PARALLEL_COUNT }, (_, i) => ({
            categories: params.categories,
            period: effectivePeriod,
            start: currentStart + i * INCREMENTAL_BATCH_SIZE,
            maxResults: INCREMENTAL_BATCH_SIZE,
          }));

          const rawResponses = await Promise.all(
            requests.map((req) => syncApi(req, { apiKey, signal: abortController.signal }))
          );

          const responses = rawResponses.map(normalizeSyncResponse);
          const firstTotal = responses[0]?.totalResults ?? 0;
          totalRemaining = firstTotal;

          // レスポンスを start 順に並べた論文リスト（重複なし・順序保持）
          const mergedPapers = responses.flatMap((r) => r.papers);

          if (mergedPapers.length === 0) {
            completeIncrementalSync();
            onComplete?.();
            return;
          }

          const newPapers = mergedPapers.filter((p) => !existingPaperIds.has(p.id));
          if (newPapers.length > 0) {
            await addPapers(newPapers);
            for (const paper of newPapers) {
              existingPaperIds.add(paper.id);
            }
          }

          const withoutEmbedding = mergedPapers.filter(
            (p) => !p.embedding || p.embedding.length === 0
          );
          if (withoutEmbedding.length > 0 && apiKey) {
            runBackfillEmbeddings(withoutEmbedding, {
              fetchEmbedding: (text) => embeddingApi({ text }, { apiKey }).then((r) => r.embedding),
              fetchEmbeddingBatch: (texts) =>
                embeddingBatchApi({ texts }, { apiKey }).then((r) => r.embeddings),
              addPaper,
            }).catch(() => {});
          }

          const roundFetchedCount = responses.reduce((sum, r) => sum + r.fetchedCount, 0);
          const rangeEnd = currentStart + roundFetchedCount;
          localRanges = mergeRanges([...localRanges, [currentStart, rangeEnd]]);
          setRequestedRanges(localRanges);
          setTotalResults(totalRemaining);

          const fetchedLeadingEdge =
            localRanges.length > 0 ? Math.max(...localRanges.map(([, end]) => end)) : 0;
          const remaining = Math.max(0, totalRemaining - fetchedLeadingEdge);
          const maxReasonable = effectivePeriod
            ? MAX_REASONABLE_TOTAL_BY_PERIOD[effectivePeriod]
            : 0;
          const displayTotal =
            maxReasonable > 0 && totalRemaining > maxReasonable ? 0 : totalRemaining;
          const progressData = {
            fetched: fetchedLeadingEdge,
            fetchedThisRun: fetchedLeadingEdge - initialStoreCount,
            remaining,
            total: displayTotal,
          };
          updateProgress(progressData);
          onProgress?.(progressData);

          const nextStart = getNextStartToRequest(
            localRanges,
            totalRemaining,
            INCREMENTAL_BATCH_SIZE
          );
          if (nextStart >= totalRemaining) {
            setLastSyncedAt(now());
            completeIncrementalSync();
            onComplete?.();
            return;
          }

          await fetchNextRound();
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          if (isAbort) {
            return;
          }
          const error = err instanceof Error ? err : new Error(String(err));
          errorIncrementalSync();
          onError?.(error);
          onErrorRef.current?.(error);
        }
      };

      fetchNextRound().catch((err) => {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (isAbort) {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        errorIncrementalSync();
        onError?.(error);
        onErrorRef.current?.(error);
      });

      return abortController;
    },
    [
      storePapers,
      requestedRanges,
      totalResults,
      params,
      addPaper,
      addPapers,
      setLastSyncedAt,
      startIncrementalSync,
      updateProgress,
      completeIncrementalSync,
      errorIncrementalSync,
    ]
  );

  // まだ論文があるかどうか（ギャップがあればその補填も含む）
  const hasMore =
    totalResults === null ||
    getNextStartToRequest(requestedRanges, totalResults, SYNC_MORE_BATCH_SIZE) < totalResults;

  /**
   * Embedding 未設定の論文を手動で補完する（同期ボタンから切り離した処理）
   * SyncStatusBar の「Embeddingを補完」ボタンから呼ぶ
   */
  const runEmbeddingBackfill = useCallback(async (): Promise<void> => {
    const papers =
      typeof usePaperStore.getState === "function"
        ? usePaperStore.getState().papers
        : storePapersRef.current;
    const withoutEmbedding = papers.filter((p) => !p.embedding || p.embedding.length === 0);
    if (withoutEmbedding.length === 0) return;

    // クリック直後に「取得中」を表示する（getDecryptedApiKey の完了を待たない）
    setIsEmbeddingBackfilling(true);
    setEmbeddingBackfillProgress({ completed: 0, total: withoutEmbedding.length });

    // API key を復号化して取得（早期開始パターン）
    const apiKeyPromise = getDecryptedApiKey();
    const apiKey = await apiKeyPromise;
    if (!apiKey) {
      setIsEmbeddingBackfilling(false);
      setEmbeddingBackfillProgress(null);
      return;
    }

    try {
      await runBackfillEmbeddings(withoutEmbedding, {
        fetchEmbedding: (text) => embeddingApi({ text }, { apiKey }).then((r) => r.embedding),
        fetchEmbeddingBatch: (texts) =>
          embeddingBatchApi({ texts }, { apiKey }).then((r) => r.embeddings),
        addPaper,
        onProgress: (completed, total) => {
          setEmbeddingBackfillProgress({ completed, total });
        },
      });
    } catch {
      // エラーは呼び出し元で toast 等表示する想定。ここでは状態だけ戻す
    } finally {
      setIsEmbeddingBackfilling(false);
      setEmbeddingBackfillProgress(null);
    }
  }, [addPaper]);

  return {
    /** 同期を実行する関数（最初から取得） */
    sync,
    /** 追加同期を実行する関数（次のページを取得） */
    syncMore,
    /** 同期期間内の未取得論文を順次取得する関数（バックグラウンド実行） */
    syncIncremental,
    /** Embedding 未設定の論文を手動で補完する関数（SyncStatusBar の「Embeddingを補完」から呼ぶ） */
    runEmbeddingBackfill,
    /** 論文取得中かどうか（初回 sync / syncMore。Embedding バックフィルは含まない） */
    isSyncing: isFetching || isLoadingMore,
    /** Embedding バックフィル実行中かどうか（SyncStatusBar 等で表示用） */
    isEmbeddingBackfilling,
    /** Embedding バックフィル進捗（取得中のみ。SyncStatusBar で「N/M件」表示） */
    embeddingBackfillProgress,
    /** まだ論文があるかどうか */
    hasMore,
    /** 全件数 */
    totalResults,
    /** エラー */
    error: error instanceof Error ? error : null,
  };
};
