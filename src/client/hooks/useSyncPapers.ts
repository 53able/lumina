import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, SyncPeriod, SyncResponse } from "../../shared/schemas/index";
import { normalizeDate, now, timestamp } from "../../shared/utils/dateTime";
import {
  embeddingApi,
  embeddingBatchApi,
  getDecryptedApiKey,
  SyncRateLimitError,
  syncApi,
} from "../lib/api";
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

/** syncMore の1リクエストあたりの取得件数（APIデフォルトと一致） */
const SYNC_MORE_BATCH_SIZE = 50;

/** 既存論文 ID の最大送信数（リクエストサイズとサーバ負荷のバランス） */
const EXISTING_PAPER_IDS_MAX = 2000;

/** syncFromDate の1ページあたりの取得件数 */
const SYNC_FROM_DATE_PAGE_SIZE = 200;

/** 1 回の syncFromDate で行う最大リクエスト数（totalResults が過大な場合の打ち止め。50 × 200 = 最大 10,000 件） */
const SYNC_FROM_DATE_MAX_PAGES = 50;

/** unknown を確実に Error に変換する */
const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * 既存論文IDセットに含まれない新規論文のみを返す
 */
const filterNewPapers = (papers: Paper[], existingPapers: Paper[]): Paper[] => {
  const existingIds = new Set(existingPapers.map((p) => p.id));
  return papers.filter((p) => !existingIds.has(p.id));
};

/**
 * 既存論文IDの送信対象をページ範囲に合わせて抽出する
 * @param papers 既存論文配列
 * @param start 同期開始位置
 * @param maxResults 1リクエストあたりの取得件数
 */
const buildExistingPaperIdsForRange = (
  papers: Paper[],
  start: number,
  maxResults: number
): string[] | undefined => {
  const range = papers.slice(start, start + maxResults);
  if (range.length > 0) {
    return range.map((p) => p.id);
  }
  if (papers.length > 0) {
    return papers.slice(0, EXISTING_PAPER_IDS_MAX).map((p) => p.id);
  }
  return undefined;
};

/**
 * syncMore で次にリクエストすべき開始位置を計算する
 *
 * - ranges が空でストアに論文がある場合: refetch 完了前のためストア件数を使用
 * - next が 0 でストアに論文がある場合: refetch と重複するため skip し、ストア件数を使用
 * - それ以外: getNextStartToRequest の計算値をそのまま使用
 *
 * @returns 次の開始位置。totalResults に達している場合は null を返す
 */
const computeEffectiveStart = (
  ranges: [number, number][],
  total: number,
  storePapers: Paper[]
): number | null => {
  const next = getNextStartToRequest(ranges, total, SYNC_MORE_BATCH_SIZE);
  if (total !== 0 && next >= total) return null;

  if (storePapers.length === 0) return next;
  if (ranges.length === 0) return storePapers.length;
  if (next === 0) return storePapers.length;
  return next;
};

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
  ["sync", params.categories.sort().join(","), params.period ?? "1"] as const;

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
    /** 成功時。isInitialSync: true は初回同期（refetch/キャッシュ利用）時のみ。false は syncMore 時。addedCount はストアに実際に追加した件数。isSyncAllRunning が true の間はバッチ別トーストは出さず、onSyncAllComplete で1回だけ出す想定。 */
    onSuccess?: (
      data: SyncResponse,
      context?: { isInitialSync: boolean; addedCount: number; isSyncAllRunning?: boolean }
    ) => void;
    /** syncAll 終了時に呼ぶ。合計で追加した件数と、ユーザー停止かどうか。停止時は「完了」と誤解しない文言でトーストする想定。 */
    onSyncAllComplete?: (totalAddedCount: number, context?: { wasAborted: boolean }) => void;
    onError?: (error: Error) => void;
    /** 429 を検出したときに1回だけ呼ぶ（リトライ前。トーストで「再試行中」を出したい場合） */
    onRateLimited?: () => void;
    /** syncFromDate 成功時。addedCount は実際に追加した件数、totalFetched は API が返した件数（0 の場合は範囲に論文なし） */
    onSyncFromDateSuccess?: (addedCount: number, totalFetched?: number) => void;
    /** syncFromDate 失敗時 */
    onSyncFromDateError?: (error: Error) => void;
  }
) => {
  const { addPaper, addPapers, papers: storePapers } = usePaperStore();
  const { setLastSyncedAt } = useSettingsStore();
  const queryClient = useQueryClient();

  // コールバックをrefで安定化（依存配列での無限ループを防ぐ）
  const onSuccessRef = useRef(options?.onSuccess);
  const onErrorRef = useRef(options?.onError);
  const onSyncAllCompleteRef = useRef(options?.onSyncAllComplete);
  const onRateLimitedRef = useRef(options?.onRateLimited);
  const onSyncFromDateSuccessRef = useRef(options?.onSyncFromDateSuccess);
  const onSyncFromDateErrorRef = useRef(options?.onSyncFromDateError);
  onSuccessRef.current = options?.onSuccess;
  onErrorRef.current = options?.onError;
  onSyncAllCompleteRef.current = options?.onSyncAllComplete;
  onRateLimitedRef.current = options?.onRateLimited;
  onSyncFromDateSuccessRef.current = options?.onSyncFromDateSuccess;
  onSyncFromDateErrorRef.current = options?.onSyncFromDateError;

  /** 同期状態は syncStore に集約。フックは store を購読して返り値に反映する */
  const requestedRanges = useSyncStore((s) => s.requestedRanges);
  const totalResults = useSyncStore((s) => s.totalResults);
  const isLoadingMore = useSyncStore((s) => s.isLoadingMore);
  const isSyncingAll = useSyncStore((s) => s.isSyncingAll);
  const syncAllProgress = useSyncStore((s) => s.syncAllProgress);
  const isEmbeddingBackfilling = useSyncStore((s) => s.isEmbeddingBackfilling);
  const embeddingBackfillProgress = useSyncStore((s) => s.embeddingBackfillProgress);
  const lastSyncError = useSyncStore((s) => s.lastSyncError);

  /** syncFromDate 実行中かどうか（StatsPage の少ない日クリック用） */
  const [isSyncingFromDate, setIsSyncingFromDate] = useState(false);

  // 同期フラグ（レースコンディション防止用）。useState は非同期バッチ更新のため連続呼び出しを防げない
  const isLoadingMoreRef = useRef(false);
  /** effect 内で getState が使えない場合（テスト等）のフォールバック用。常に最新の storePapers を指す */
  const storePapersRef = useRef(storePapers);
  storePapersRef.current = storePapers;
  /** syncMore 用のレートリミット待機（現状は no-op） */
  const waitForRateLimitRef = useRef<() => Promise<void>>(async () => {});

  /** syncAll 停止用。abort すると syncMore のリクエストとループが止まる */
  const syncAllAbortRef = useRef<AbortController | null>(null);
  /** syncAll 実行中か（onSuccess でバッチ別トーストを出さないためと累積用） */
  const isSyncAllRunningRef = useRef(false);
  /** syncAll 中の追加件数合計（完了時に onSyncAllComplete で渡す） */
  const syncAllAccumulatedRef = useRef(0);

  /** ストアの論文配列を取得（effect 内やテストで getState が使えない場合は ref を使用） */
  const getStorePapers = useCallback((): Paper[] => {
    return typeof usePaperStore.getState === "function"
      ? usePaperStore.getState().papers
      : storePapersRef.current;
  }, []);

  /**
   * 同期成功時の共通処理: ストア更新・タイムスタンプ更新・onSuccess コールバック呼び出し
   *
   * @param response 同期レスポンス
   * @param rangeStart 取得開始位置（0 = 初回、n = syncMore）
   * @param newPapers ストアに追加した新規論文
   * @param isInitialSync 初回同期（refetch/キャッシュ）か syncMore かの識別
   */
  const commitSyncResult = useCallback(
    (
      response: SyncResponse,
      rangeStart: number,
      newPapers: Paper[],
      isInitialSync: boolean
    ): void => {
      const store = useSyncStore.getState();
      store.setRequestedRanges(
        mergeRanges([...store.requestedRanges, [rangeStart, rangeStart + response.fetchedCount]])
      );
      store.setTotalResults(response.totalResults);
      setLastSyncedAt(now());
      store.setLastSyncError(null);
      const running = isSyncAllRunningRef.current;
      if (running) syncAllAccumulatedRef.current += newPapers.length;
      onSuccessRef.current?.(response, {
        isInitialSync,
        addedCount: newPapers.length,
        isSyncAllRunning: running,
      });
    },
    [setLastSyncedAt]
  );

  const queryKey = createSyncQueryKey(params);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<SyncResponse> => {
      // API key を復号化して取得（早期開始パターン）
      const apiKeyPromise = getDecryptedApiKey();
      const apiKey = await apiKeyPromise;

      const currentPapers = getStorePapers();
      const existingPaperIds = buildExistingPaperIdsForRange(currentPapers, 0, 200);

      const response = await syncApi(
        {
          categories: params.categories,
          period: params.period,
          start: 0, // 初回は常に0から
          maxResults: 200,
          ...(existingPaperIds != null && existingPaperIds.length > 0 ? { existingPaperIds } : {}),
        },
        { apiKey, signal, onRateLimited: () => onRateLimitedRef.current?.() }
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

    const currentStorePapers = getStorePapers();

    // DBに既に存在する論文をスキップ
    const newPapers = filterNewPapers(data.papers, currentStorePapers);

    if (newPapers.length > 0) {
      addPapers(newPapers);
    }
    commitSyncResult(data, 0, newPapers, true);

    // Embedding 補完は同期ボタンから切り離し。手動で「Embeddingを補完」ボタンから実行する。
  }, [data, addPapers, commitSyncResult, getStorePapers]);

  // エラー時の処理（query の error を保持し、onError コールバックを呼ぶ）
  // ユーザーが停止した場合（AbortError）はエラー表示しない
  useEffect(() => {
    if (!error) return;
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    if (isAbort) return;
    const err = toError(error);
    useSyncStore.getState().setLastSyncError(err);
    onErrorRef.current?.(err);
  }, [error]);

  /** isFetching を syncStore に同期（子コンポーネントが store から isSyncing を導出できるようにする） */
  useEffect(() => {
    useSyncStore.getState().setIsFetching(isFetching);
  }, [isFetching]);

  // 同期実行関数（最初から取得）
  const sync = useCallback(() => {
    // キャッシュが新鮮（5分以内）かチェック
    const cachedData = queryClient.getQueryData<SyncResponse>(queryKey);
    const queryState = queryClient.getQueryState(queryKey);
    const isStale =
      !queryState?.dataUpdatedAt || timestamp() - queryState.dataUpdatedAt > SYNC_STALE_TIME;

    if (cachedData && !isStale) {
      // キャッシュが有効 → 再利用（APIを叩かない）。既存を除いた分だけストアに追加
      const currentStorePapers = getStorePapers();
      const newPapersFromCache = filterNewPapers(cachedData.papers, currentStorePapers);
      if (newPapersFromCache.length > 0) {
        addPapers(newPapersFromCache);
      }
      const store = useSyncStore.getState();
      store.setRequestedRanges(
        mergeRanges([...store.requestedRanges, [0, cachedData.fetchedCount]])
      );
      store.setTotalResults(cachedData.totalResults);
      const running = isSyncAllRunningRef.current;
      if (running) syncAllAccumulatedRef.current += newPapersFromCache.length;
      onSuccessRef.current?.(cachedData, {
        isInitialSync: true,
        addedCount: newPapersFromCache.length,
        isSyncAllRunning: running,
      });
      return;
    }

    // キャッシュが古いか存在しない → APIを叩く
    useSyncStore.getState().setRequestedRanges([]);
    useSyncStore.getState().setTotalResults(null);
    void refetch();
  }, [queryClient, queryKey, addPapers, refetch, getStorePapers]);

  // 追加同期実行関数（次のページを取得）。syncAll ループから呼ばれても最新状態を参照するため ref を使用
  /** @param abortSignal syncAll から呼ぶときに渡すと、停止ボタンでこのリクエストを中止できる */
  const syncMore = useCallback(
    async (abortSignal?: AbortSignal) => {
      // useRef で同期的にチェック（レースコンディション防止）
      // useState の setIsLoadingMore(true) は React のバッチ更新で遅延するため、
      // IntersectionObserver の連続発火を防げない
      if (isLoadingMoreRef.current) {
        return;
      }

      const syncState = useSyncStore.getState();
      const currentRanges = syncState.requestedRanges;
      const currentTotal = syncState.totalResults ?? 0;
      const currentStorePapers = storePapersRef.current;

      const effectiveStart = computeEffectiveStart(currentRanges, currentTotal, currentStorePapers);
      if (effectiveStart === null) {
        return;
      }

      // 同期フラグを即座に立てる（レースコンディション防止）
      isLoadingMoreRef.current = true;
      useSyncStore.getState().setIsLoadingMore(true);

      try {
        // レートリミットを考慮して待機
        await waitForRateLimitRef.current();

        // API key を復号化して取得（早期開始パターン）
        const apiKeyPromise = getDecryptedApiKey();
        const apiKey = await apiKeyPromise;

        const existingPaperIds = buildExistingPaperIdsForRange(
          storePapersRef.current,
          effectiveStart,
          200
        );

        const rawResponse = await syncApi(
          {
            categories: params.categories,
            period: params.period,
            start: effectiveStart,
            maxResults: 200,
            ...(existingPaperIds != null && existingPaperIds.length > 0
              ? { existingPaperIds }
              : {}),
          },
          { apiKey, signal: abortSignal, onRateLimited: () => onRateLimitedRef.current?.() }
        );
        // 日付文字列を Date オブジェクトに正規化
        const response = normalizeSyncResponse(rawResponse);

        // DBに既に存在する論文をスキップ（syncAll ループ内では storePapersRef が最新）
        const newPapers = filterNewPapers(response.papers, storePapersRef.current);
        if (newPapers.length > 0) {
          addPapers(newPapers);
        }
        if (response.papers.length > 0) {
          commitSyncResult(response, effectiveStart, newPapers, false);
        }
      } catch (err) {
        // ユーザーが停止した場合はエラー扱いにしない
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) {
          const e = toError(err);
          useSyncStore.getState().setLastSyncError(e);
          onErrorRef.current?.(e);
        }
      } finally {
        isLoadingMoreRef.current = false;
        useSyncStore.getState().setIsLoadingMore(false);
      }
    },
    [params, addPapers, commitSyncResult]
  );

  // まだ論文があるかどうか（ギャップがあればその補填も含む）
  const hasMore =
    totalResults === null ||
    getNextStartToRequest(requestedRanges, totalResults, SYNC_MORE_BATCH_SIZE) < totalResults;

  /**
   * 同期期間内の論文をすべて取得する（初回 sync のあと hasMore の間 syncMore を繰り返す）
   * 初回 sync 完了は syncStore.totalResults のセットで判定（refetch の Promise はテスト環境で解決されない場合があるため）
   * stopSync 呼び出しでループと進行中の syncMore を中止する。
   */
  const syncAll = useCallback(async (): Promise<void> => {
    const ac = new AbortController();
    syncAllAbortRef.current = ac;
    isSyncAllRunningRef.current = true;
    syncAllAccumulatedRef.current = 0;
    useSyncStore.getState().setIsSyncingAll(true);
    useSyncStore.getState().setSyncAllProgress(null);

    let completedNormally = false;
    try {
      sync();

      const deadline = Date.now() + 15_000;
      while (useSyncStore.getState().totalResults === null && Date.now() < deadline) {
        if (ac.signal.aborted) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      }

      for (;;) {
        if (ac.signal.aborted) break;
        const state = useSyncStore.getState();
        const nextStart = getNextStartToRequest(
          state.requestedRanges,
          state.totalResults ?? 0,
          SYNC_MORE_BATCH_SIZE
        );
        const total = state.totalResults ?? 0;
        if (total !== 0 && nextStart >= total) {
          completedNormally = true;
          break;
        }
        const fetched = getStorePapers().length;
        useSyncStore.getState().setSyncAllProgress({ fetched, total });
        try {
          await syncMore(ac.signal);
        } catch (syncMoreErr) {
          const e = toError(syncMoreErr);
          useSyncStore.getState().setLastSyncError(e);
          onErrorRef.current?.(e);
          break;
        }
        await new Promise<void>((r) => setTimeout(r, 0)); // state 更新を待つ
      }
    } catch (err) {
      const e = toError(err);
      useSyncStore.getState().setLastSyncError(e);
      onErrorRef.current?.(e);
    } finally {
      const totalAdded = syncAllAccumulatedRef.current;
      const wasAborted = !completedNormally;
      isSyncAllRunningRef.current = false;
      syncAllAbortRef.current = null;
      useSyncStore.getState().setIsSyncingAll(false);
      useSyncStore.getState().setSyncAllProgress(null);
      onSyncAllCompleteRef.current?.(totalAdded, { wasAborted });
    }
  }, [sync, syncMore, getStorePapers]);

  /**
   * 同期を停止する（初回 sync の refetch と syncAll の syncMore ループを中止）
   */
  const stopSync = useCallback(() => {
    syncAllAbortRef.current?.abort();
    queryClient.cancelQueries({ queryKey });
  }, [queryClient, queryKey]);

  /**
   * Embedding 未設定の論文を手動で補完する（同期ボタンから切り離した処理）
   * SyncStatusBar の「Embeddingを補完」ボタンから呼ぶ
   */
  const runEmbeddingBackfill = useCallback(async (): Promise<void> => {
    const papers = getStorePapers();
    const withoutEmbedding = papers.filter((p) => !p.embedding || p.embedding.length === 0);
    if (withoutEmbedding.length === 0) return;

    // クリック直後に「取得中」を表示する（getDecryptedApiKey の完了を待たない）
    useSyncStore.getState().setIsEmbeddingBackfilling(true);
    useSyncStore.getState().setEmbeddingBackfillProgress({
      completed: 0,
      total: withoutEmbedding.length,
    });

    // API key を復号化して取得（早期開始パターン）
    const apiKeyPromise = getDecryptedApiKey();
    const apiKey = await apiKeyPromise;
    if (!apiKey) {
      useSyncStore.getState().setIsEmbeddingBackfilling(false);
      useSyncStore.getState().setEmbeddingBackfillProgress(null);
      return;
    }

    try {
      await runBackfillEmbeddings(withoutEmbedding, {
        fetchEmbedding: (text) => embeddingApi({ text }, { apiKey }).then((r) => r.embedding),
        fetchEmbeddingBatch: (texts) =>
          embeddingBatchApi({ texts }, { apiKey }).then((r) => r.embeddings),
        addPaper,
        onProgress: (completed, total) => {
          useSyncStore.getState().setEmbeddingBackfillProgress({ completed, total });
        },
      });
    } catch {
      // エラーは呼び出し元で toast 等表示する想定。ここでは状態だけ戻す
    } finally {
      useSyncStore.getState().setIsEmbeddingBackfilling(false);
      useSyncStore.getState().setEmbeddingBackfillProgress(null);
    }
  }, [addPaper, getStorePapers]);

  /**
   * 指定した日を終了日として「最大365日前 〜 その日」の論文を、ページングで連続取得しストアに追加する。
   * ユーザーの syncPeriodDays 設定に依存せず、その日以前の論文を広く取得する。
   * requestedRanges / totalResults は更新しない（通常の period 同期とは別扱い）
   */
  const syncFromDate = useCallback(
    async (date: string): Promise<void> => {
      setIsSyncingFromDate(true);
      try {
        await waitForRateLimitRef.current();
        const apiKey = await getDecryptedApiKey();
        let totalAdded = 0;
        let totalFetched = 0;
        let start = 0;
        let pageCount = 0;

        for (;;) {
          if (pageCount >= SYNC_FROM_DATE_MAX_PAGES) break;
          pageCount += 1;
          const currentPapers = getStorePapers();
          const existingPaperIds =
            currentPapers.length > 0
              ? currentPapers.slice(0, EXISTING_PAPER_IDS_MAX).map((p) => p.id)
              : undefined;

          const rawResponse = await syncApi(
            {
              categories: params.categories,
              period: "365",
              toDate: date,
              start,
              maxResults: SYNC_FROM_DATE_PAGE_SIZE,
              ...(existingPaperIds != null && existingPaperIds.length > 0
                ? { existingPaperIds }
                : {}),
            },
            { apiKey, onRateLimited: () => onRateLimitedRef.current?.() }
          );
          const response = normalizeSyncResponse(rawResponse);
          const newPapers = filterNewPapers(response.papers, getStorePapers());
          if (newPapers.length > 0) {
            addPapers(newPapers);
          }
          totalAdded += newPapers.length;
          totalFetched += response.papers.length;

          const isLastPage =
            response.papers.length < SYNC_FROM_DATE_PAGE_SIZE ||
            start + response.papers.length >= response.totalResults;
          if (isLastPage) break;
          start += SYNC_FROM_DATE_PAGE_SIZE;
        }

        setLastSyncedAt(now());
        onSyncFromDateSuccessRef.current?.(totalAdded, totalFetched);
      } catch (err) {
        const e = toError(err);
        onSyncFromDateErrorRef.current?.(e);
      } finally {
        setIsSyncingFromDate(false);
      }
    },
    [params.categories, getStorePapers, addPapers, setLastSyncedAt]
  );

  return {
    /** 同期を実行する関数（最初から取得） */
    sync,
    /** 追加同期を実行する関数（次のページを取得） */
    syncMore,
    /** 同期期間内の論文をすべて取得する関数 */
    syncAll,
    /** 同期を停止する（refetch と syncAll ループを中止） */
    stopSync,
    /** Embedding 未設定の論文を手動で補完する関数（SyncStatusBar の「Embeddingを補完」から呼ぶ） */
    runEmbeddingBackfill,
    /** 指定日以前の最大365日分の論文を取得する関数（StatsPage の少ない日クリック用） */
    syncFromDate,
    /** syncFromDate 実行中かどうか */
    isSyncingFromDate,
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
    syncRateLimitError: lastSyncError instanceof SyncRateLimitError ? lastSyncError : null,
  };
};
