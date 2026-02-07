import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, SyncPeriod, SyncResponse } from "../../shared/schemas/index";
import { normalizeDate, now, timestamp } from "../../shared/utils/dateTime";
import {
  embeddingApi,
  embeddingBatchApi,
  getDecryptedApiKey,
  syncApi,
  SyncRateLimitError,
} from "../lib/api";
import { runBackfillEmbeddings } from "../lib/backfillEmbeddings";
import { getNextStartToRequest, mergeRanges } from "../lib/syncPagingUtils";
import { usePaperStore } from "../stores/paperStore";
import { useSettingsStore } from "../stores/settingsStore";

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

/** syncMore の1リクエストあたりの取得件数（APIデフォルトと一致） */
const SYNC_MORE_BATCH_SIZE = 50;

/**
 * 同期APIの入力パラメータ
 */
interface SyncParams {
  /** 同期対象のカテゴリ */
  categories: string[];
  /** 同期期間（日数）。共有スキーマ SyncPeriod に合わせる */
  period?: SyncPeriod;
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
 * @returns sync, syncMore, syncAll, isSyncing, isSyncingAll, syncAllProgress, hasMore, totalResults, error など。syncAll は同期期間内の論文を全件取得する。
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
  /** effect 内で getState が使えない場合（テスト等）のフォールバック用。常に最新の storePapers を指す */
  const storePapersRef = useRef(storePapers);
  storePapersRef.current = storePapers;
  /** syncMore 用のレートリミット待機（現状は no-op） */
  const waitForRateLimitRef = useRef<() => Promise<void>>(async () => {});

  /** syncAll ループで最新の hasMore を参照するため */
  const hasMoreRef = useRef(false);
  /** syncAll ループで最新の totalResults を参照するため */
  const totalResultsRef = useRef<number | null>(null);
  /** syncMore が syncAll ループ内から呼ばれたときに最新範囲を参照するため */
  const requestedRangesRef = useRef<[number, number][]>([]);
  /** 同期期間内の論文をすべて取得中か */
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  /** すべて取得の進捗（取得済み件数 / 全件数） */
  const [syncAllProgress, setSyncAllProgress] = useState<{
    fetched: number;
    total: number;
  } | null>(null);
  /** 直近の同期エラー（refetch または syncMore で発生。429 時は UI でメッセージ表示用） */
  const [lastSyncError, setLastSyncError] = useState<Error | null>(null);

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
          maxResults: 200,
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
    setLastSyncError(null); // 成功時にエラー表示をクリア
    onSuccessRef.current?.(data);

    // Embedding 補完は同期ボタンから切り離し。手動で「Embeddingを補完」ボタンから実行する。
  }, [data, addPapers, setLastSyncedAt]);

  // エラー時の処理（query の error を保持し、onError コールバックを呼ぶ）
  useEffect(() => {
    if (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setLastSyncError(err);
      onErrorRef.current?.(err);
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
    void refetch();
  }, [queryClient, queryKey, addPapers, refetch]);

  // 追加同期実行関数（次のページを取得）。syncAll ループから呼ばれても最新状態を参照するため ref を使用
  const syncMore = useCallback(async () => {
    // useRef で同期的にチェック（レースコンディション防止）
    // useState の setIsLoadingMore(true) は React のバッチ更新で遅延するため、
    // IntersectionObserver の連続発火を防げない
    if (isLoadingMoreRef.current) {
      return;
    }

    const currentRanges = requestedRangesRef.current;
    const currentTotal = totalResultsRef.current ?? 0;
    const currentStorePapers = storePapersRef.current;

    // 次にリクエストすべき start（ギャップがあればその先頭、なければ先頭の連続の次）
    const nextStartComputed = getNextStartToRequest(
      currentRanges,
      currentTotal,
      SYNC_MORE_BATCH_SIZE
    );
    const effectiveStart =
      currentRanges.length === 0 && currentStorePapers.length > 0
        ? currentStorePapers.length
        : nextStartComputed;

    if (currentTotal !== 0 && effectiveStart >= currentTotal) {
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
          maxResults: 200,
        },
        { apiKey }
      );
      // 日付文字列を Date オブジェクトに正規化
      const response = normalizeSyncResponse(rawResponse);

      if (response.papers.length > 0) {
        // DBに既に存在する論文をスキップ（syncAll ループ内では storePapersRef が最新）
        const existingPaperIds = new Set(storePapersRef.current.map((p) => p.id));
        const newPapers = response.papers.filter((p) => !existingPaperIds.has(p.id));

        if (newPapers.length > 0) {
          addPapers(newPapers);
        }
        setRequestedRanges((prev) =>
          mergeRanges([...prev, [effectiveStart, effectiveStart + response.fetchedCount]])
        );
        setTotalResults(response.totalResults);
        setLastSyncedAt(now());
        setLastSyncError(null); // 成功時にエラー表示をクリア
        onSuccessRef.current?.(response);

        // Embedding 補完は同期ボタンから切り離し。手動で「Embeddingを補完」から実行する。
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setLastSyncError(e);
      onErrorRef.current?.(e);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [params, addPapers, setLastSyncedAt]);

  // まだ論文があるかどうか（ギャップがあればその補填も含む）
  const hasMore =
    totalResults === null ||
    getNextStartToRequest(requestedRanges, totalResults, SYNC_MORE_BATCH_SIZE) < totalResults;

  hasMoreRef.current = hasMore;
  totalResultsRef.current = totalResults;
  requestedRangesRef.current = requestedRanges;

  /**
   * 同期期間内の論文をすべて取得する（初回 sync のあと hasMore の間 syncMore を繰り返す）
   * 初回 sync 完了は totalResultsRef のセットで判定（refetch の Promise はテスト環境で解決されない場合があるため）
   */
  const syncAll = useCallback(async (): Promise<void> => {
    setIsSyncingAll(true);
    setSyncAllProgress(null);

    sync();

    const deadline = Date.now() + 15_000;
    while (totalResultsRef.current === null && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    while (hasMoreRef.current) {
      const total = totalResultsRef.current ?? 0;
      const fetched =
        typeof usePaperStore.getState === "function"
          ? usePaperStore.getState().papers.length
          : storePapersRef.current.length;
      setSyncAllProgress({ fetched, total });
      await syncMore();
      await new Promise<void>((r) => setTimeout(r, 0)); // state 更新を待つ
    }

    setIsSyncingAll(false);
    setSyncAllProgress(null);
  }, [sync, syncMore]);

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
    /** 同期期間内の論文をすべて取得する関数 */
    syncAll,
    /** Embedding 未設定の論文を手動で補完する関数（SyncStatusBar の「Embeddingを補完」から呼ぶ） */
    runEmbeddingBackfill,
    /** 論文取得中かどうか（初回 sync / syncMore。Embedding バックフィルは含まない） */
    isSyncing: isFetching || isLoadingMore,
    /** 同期期間の論文をすべて取得中かどうか */
    isSyncingAll,
    /** すべて取得の進捗（取得済み / 全件数）。取得中のみセットされる */
    syncAllProgress,
    /** Embedding バックフィル実行中かどうか（SyncStatusBar 等で表示用） */
    isEmbeddingBackfilling,
    /** Embedding バックフィル進捗（取得中のみ。SyncStatusBar で「N/M件」表示） */
    embeddingBackfillProgress,
    /** まだ論文があるかどうか */
    hasMore,
    /** 全件数 */
    totalResults,
    /** エラー（React Query の refetch 由来） */
    error: error instanceof Error ? error : null,
    /** 429 レート制限エラー時のみセット。SyncStatusBar で「状況＋対処」を表示するために使う */
    syncRateLimitError:
      lastSyncError instanceof SyncRateLimitError ? lastSyncError : null,
  };
};
