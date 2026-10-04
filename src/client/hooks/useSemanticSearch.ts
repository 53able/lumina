import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpandedQuery, Paper } from "../../shared/schemas/index";
import { getDecryptedApiKey, searchApi } from "../lib/api";
import {
  hasPaperEmbedding,
  type PaperSearchMatches,
  type PaperSearchSource,
} from "../lib/paperIndex/core";
import { SearchComputeError } from "../lib/searchErrors";
import { paperStoreSearchSource } from "../stores/paperStore";

/**
 * 検索結果の型
 */
export interface SearchResult {
  /** 論文データ */
  paper: Paper;
  /** 類似度スコア（0-1） */
  score: number;
}

/**
 * 検索の進行状態
 * - idle: 検索していない
 * - requesting: 検索API（クエリ拡張・Embedding）を待っている
 * - waiting-for-papers: 保存済み論文の全件準備を待っている（読み込み途中の部分集合では確定しない）
 * - computing: 索引で類似度を計算している
 * - done: 結果が確定した
 * - error: 失敗した
 */
export type SearchPhase =
  | "idle"
  | "requesting"
  | "waiting-for-papers"
  | "computing"
  | "done"
  | "error";

/**
 * useSemanticSearchのオプション
 */
interface UseSemanticSearchOptions {
  /** 検索対象の論文配列（結果の論文は ID でここから引く。embedding は不要） */
  papers: Paper[];
  /** 取得件数 */
  limit?: number;
  /** 類似度スコアの閾値（これ以下の結果は除外） */
  scoreThreshold?: number;
  /** 検索の実行元（既定は paperStore の索引。テストで差し替える） */
  searchSource?: PaperSearchSource;
}

/**
 * useSemanticSearchの戻り値
 */
interface UseSemanticSearchReturn {
  /**
   * 検索関数（結果を直接返す）。
   * 保存済み論文の全件準備を待ってから索引を検索し、確定した結果を返す。
   * 返り値はその時点のスナップショットで、その後の論文更新には追従しない
   * （追従する結果は results / papersExcludedFromSearch / totalMatchCount を参照する）。
   * editedQuery を渡すとクエリ拡張を省き、その searchText をそのまま Embedding に使う
   * （確認・編集した変換文での再検索用。英訳・関連語は editedQuery のものを表示に残す）。
   */
  search: (query: string, editedQuery?: ExpandedQuery) => Promise<SearchResult[]>;
  /**
   * 保存済みデータで検索する関数（APIリクエストなし）。
   * 返り値は search と同じく確定時点のスナップショット。
   */
  searchWithSavedData: (
    expandedQuery: ExpandedQuery,
    queryEmbedding: number[],
    query?: string
  ) => Promise<SearchResult[]>;
  /** 検索結果（未確定なら空。新しい検索の実行中・失敗時は前回の検索の確定結果を保持する） */
  results: SearchResult[];
  /** 検索対象外（Embeddingなし）の論文（常時可視化用。確定前は空） */
  papersExcludedFromSearch: Paper[];
  /** ローディング状態（API待ち・全件準備待ち・計算中） */
  isLoading: boolean;
  /** 保存済み論文の全件準備を待っているか（待機中の文言表示用） */
  isWaitingForPapers: boolean;
  /** 現在の検索の結果が全件に対して確定したか（履歴の保存・「該当なし」表示の条件） */
  resultsReady: boolean;
  /** 検索の進行状態 */
  searchPhase: SearchPhase;
  /** エラー */
  error: Error | null;
  /** 拡張クエリ */
  expandedQuery: ExpandedQuery | null;
  /** 現在のクエリEmbedding */
  queryEmbedding: number[] | null;
  /** 直近の検索でヒットした総件数（limit適用前。履歴の結果件数表示用。確定前は 0） */
  totalMatchCount: number;
  /** 表示中の結果の計算に使ったしきい値（しきい値を変えた直後の再計算中は変更前の値。未確定なら null） */
  resultsScoreThreshold: number | null;
  /** 表示中の結果を得た検索のクエリ（結果がない・失敗の表示用の stub なら null） */
  resultQuery: string | null;
  /**
   * 表示中の結果が前回の検索のものか（新しい検索の実行中・失敗時に前回の結果を保持している）。
   * 新しい検索の成功結果と誤認させないよう、表示側で「前回の結果」と区別するために使う。
   */
  isShowingPreviousResults: boolean;
  /** 実行中の検索を中止する（通信・計算を無効化して応答を採用しない。前回の結果は保持する） */
  cancel: () => void;
  /**
   * 直近に失敗した検索を同じ経路・同じ条件でもう一度実行する。
   * 拡張クエリと Embedding を得てから失敗した検索（全件準備・計算の失敗）・保存済み Embedding での検索は、
   * 検索APIを呼ばずに保存済みデータの経路でやり直す。Embedding を得る前に失敗した検索だけ検索APIを呼ぶ。
   * 直近の試行が query の検索でなければ（中止・クリア後など）何もせず null を返す。
   */
  retry: (query: string) => Promise<SearchResult[]> | null;
  /** 状態リセット関数（実行中の検索も無効化し、その応答を採用しない） */
  reset: () => void;
}

/**
 * 検索の試行の条件（失敗した検索を同じ経路で再試行するため）
 * - api: 検索APIからやり直す（Embedding を得る前の失敗）
 * - saved: 得られた・保存済みの拡張クエリと Embedding で索引の計算だけをやり直す
 */
type SearchAttempt =
  | { via: "api"; query: string; editedQuery?: ExpandedQuery }
  | {
      via: "saved";
      query: string;
      expandedQuery: ExpandedQuery;
      queryEmbedding: number[] | null;
    };

/**
 * 表示中の結果の出どころ（結果を得た検索）
 */
interface ShownSearch {
  /** 検索したクエリ（利用者の入力） */
  query: string;
  expandedQuery: ExpandedQuery;
  queryEmbedding: number[] | null;
  /**
   * 失敗の理由を一覧の0件表示に出すための stub か（前回の結果がない検索の失敗。キー復号失敗・論文の読み込み失敗）。
   * stub は前回の結果として扱わない
   */
  isStub: boolean;
}

/** 類似度スコアのデフォルト閾値 */
const DEFAULT_SCORE_THRESHOLD = 0.3;

/** 検索結果の計算結果 */
interface ComputedSearchResults {
  /** 類似度順・limit 適用後の結果 */
  results: SearchResult[];
  /** 検索対象外（Embeddingなし）の論文 */
  excluded: Paper[];
  /** ヒット総数（limit 適用前） */
  totalMatchCount: number;
  /** 計算に使った入力（入力が変わったら再計算する） */
  key: {
    queryEmbedding: number[] | null;
    papers: Paper[];
    scoreThreshold: number;
    limit: number;
  };
}

const NO_MATCHES: PaperSearchMatches = { matches: [], totalMatchCount: 0 };
const EMPTY_RESULTS: SearchResult[] = [];
const EMPTY_PAPERS: Paper[] = [];

/** unknown を確実に Error に変換する */
const toError = (e: unknown): Error => (e instanceof Error ? e : new Error("Unknown error"));

/**
 * useSemanticSearch - セマンティック検索フック
 *
 * Design Docsに基づく機能:
 * - 検索APIを呼び出し、クエリ拡張とEmbeddingを取得
 * - 保存済み論文の索引（Web Worker）でコサイン類似度を計算
 * - 類似度順の結果を返す
 *
 * 保存済み論文の読み込み途中では結果を確定せず、全件の準備完了を待ってから計算する。
 *
 * @param options オプション
 * @returns 検索状態と操作関数
 */
export const useSemanticSearch = ({
  papers,
  limit = 20,
  scoreThreshold = DEFAULT_SCORE_THRESHOLD,
  searchSource,
}: UseSemanticSearchOptions): UseSemanticSearchReturn => {
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("idle");
  const [error, setError] = useState<Error | null>(null);
  // 表示中の結果の出どころと計算結果。新しい検索の開始では消さず、確定したときに一緒に置き換える
  // （実行中・失敗時は前回の結果を保持する）
  const [shown, setShown] = useState<ShownSearch | null>(null);
  const [computed, setComputed] = useState<ComputedSearchResults | null>(null);
  const expandedQuery = shown?.expandedQuery ?? null;
  const queryEmbedding = shown?.queryEmbedding ?? null;
  /** 検索の実行元の準備完了を待って再計算するための合図（準備完了のたびに進める） */
  const [sourceReadySignal, setSourceReadySignal] = useState(0);

  /**
   * 検索の実行世代。検索開始・reset のたびに進め、古い世代の応答は状態へ反映しない。
   * 通信中止は補助手段で、応答の採用可否はこの世代で判定する（中止前に届いた応答も破棄するため）。
   */
  const generationRef = useRef(0);
  /**
   * 索引での計算の連番。論文追加などによる再計算のたびに進め、古い計算結果を採用しない。
   * 再計算では generationRef を進めない（実行中の検索APIを無効化しないため）。
   */
  const computeSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 直近の検索の試行（失敗した検索を同じ経路で再試行するため） */
  const lastAttemptRef = useRef<SearchAttempt | null>(null);

  // 計算は呼び出し時点の最新の入力で行う（検索関数の参照を論文更新で変えないため ref で持つ）
  const papersRef = useRef(papers);
  papersRef.current = papers;
  const scoreThresholdRef = useRef(scoreThreshold);
  scoreThresholdRef.current = scoreThreshold;
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const searchSourceRef = useRef(searchSource);
  searchSourceRef.current = searchSource;

  /** 検索の実行元（既定は paperStore の索引） */
  const getSearchSource = useCallback(
    (): PaperSearchSource => searchSourceRef.current ?? paperStoreSearchSource,
    []
  );

  // アンマウント時（論文詳細への遷移など）は実行中の検索を中止・無効化する
  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      generationRef.current += 1;
      computeSeqRef.current += 1;
    },
    []
  );

  /** 新しい世代を開始し、前の世代の通信と計算を無効化する */
  const startGeneration = useCallback((): number => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    generationRef.current += 1;
    computeSeqRef.current += 1;
    return generationRef.current;
  }, []);

  /**
   * 現在の入力（論文・閾値・件数）で索引を検索し、結果を組み立てる（APIリクエストなし）。
   * 結果の論文は papers から ID で引き、papers にない論文は除く。
   */
  const computeResults = useCallback(
    async (embedding: number[] | null): Promise<ComputedSearchResults> => {
      const currentPapers = papersRef.current;
      const currentThreshold = scoreThresholdRef.current;
      const currentLimit = limitRef.current;
      let found: PaperSearchMatches = NO_MATCHES;
      if (embedding && embedding.length > 0) {
        try {
          found = await getSearchSource().search(embedding, currentThreshold, currentLimit);
        } catch (e) {
          // 読み込みの失敗はそのまま、それ以外（Worker 内の計算の失敗など）は計算の失敗として区別する
          const err = toError(e);
          throw err.name === "PaperLoadError"
            ? err
            : new SearchComputeError(err.message, { cause: err });
        }
      }
      const { matches, totalMatchCount } = found;

      const paperById = new Map(currentPapers.map((paper) => [paper.id, paper]));
      const results: SearchResult[] = [];
      for (const { id, score } of matches) {
        const paper = paperById.get(id);
        if (paper) results.push({ paper, score });
      }
      return {
        results,
        excluded: currentPapers.filter((paper) => !hasPaperEmbedding(paper)),
        totalMatchCount,
        key: {
          queryEmbedding: embedding,
          papers: currentPapers,
          scoreThreshold: currentThreshold,
          limit: currentLimit,
        },
      };
    },
    [getSearchSource]
  );

  /**
   * 検索の結果を確定する。全件の準備を待ち（失敗時は reject）、索引で計算して状態へ反映する。
   * 確定したときに、表示中の結果の出どころ（next）と計算結果を一緒に置き換える（それまでは前回の結果を保持する）。
   * 世代が変わった（クリア・後続検索）場合は反映せず空を返す。
   */
  const settleSearch = useCallback(
    async (generation: number, next: Omit<ShownSearch, "isStub">): Promise<SearchResult[]> => {
      const embedding = next.queryEmbedding;
      const source = getSearchSource();
      setSearchPhase(source.isReady() ? "computing" : "waiting-for-papers");
      await source.whenReady();
      if (generation !== generationRef.current) return [];

      setSearchPhase("computing");
      computeSeqRef.current += 1;
      const seq = computeSeqRef.current;
      while (true) {
        const result = await computeResults(embedding);
        if (generation !== generationRef.current || seq !== computeSeqRef.current) return [];
        // Worker の応答待ちに入力が変わったら、最新の条件で計算し直してから確定する。
        // 古い件数で done にすると、再計算前に検索履歴へ保存されてしまう。
        if (
          result.key.papers !== papersRef.current ||
          result.key.scoreThreshold !== scoreThresholdRef.current ||
          result.key.limit !== limitRef.current
        ) {
          continue;
        }

        setShown({ ...next, isStub: false });
        // 確定後の再計算（論文更新・しきい値変更）が失敗したときの再試行は、表示中の結果の条件でやり直す
        lastAttemptRef.current = { via: "saved", ...next };
        setComputed(result);
        setSearchPhase("done");
        return result.results;
      }
    },
    [computeResults, getSearchSource]
  );

  /**
   * 検索の失敗を反映する。前回の結果があれば保持し、なければ失敗の理由を一覧の0件表示に出すための stub を置く
   * （キー復号失敗・論文の読み込み失敗。stub は前回の結果として扱わない）。
   */
  const failSearch = useCallback((err: Error, stub: Omit<ShownSearch, "isStub"> | null) => {
    setError(err);
    setSearchPhase("error");
    if (stub === null) return;
    setShown((prev) => (prev !== null && !prev.isStub ? prev : { ...stub, isStub: true }));
  }, []);

  /** 検索の開始。前回の結果は残し、失敗の stub だけを消す */
  const beginSearch = useCallback((phase: SearchPhase) => {
    setError(null);
    setSearchPhase(phase);
    setShown((prev) => (prev?.isStub ? null : prev));
  }, []);

  /**
   * 確定した結果は、論文・閾値・件数が変わったら索引で再計算する。
   * 検索表示中の論文追加・Embedding補完にも追従し、再計算に検索APIは使わない。
   * 再計算中は確定済みの結果を表示したままにする（一覧をローディング表示に戻さない）。
   * 再読み込み中（実行元が準備完了でない間）はバッチごとに全件走査を積まず、準備完了で1回だけ再計算する。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceReadySignal は準備完了後に再計算するための依存
  useEffect(() => {
    if (searchPhase !== "done" || computed === null) return;
    const { key } = computed;
    if (key.papers === papers && key.scoreThreshold === scoreThreshold && key.limit === limit) {
      return;
    }
    const generation = generationRef.current;
    const source = getSearchSource();
    if (!source.isReady()) {
      let cancelled = false;
      source.whenReady().then(
        () => {
          if (!cancelled) setSourceReadySignal((signal) => signal + 1);
        },
        (e: unknown) => {
          if (cancelled || generation !== generationRef.current) return;
          setError(toError(e));
          setSearchPhase("error");
        }
      );
      return () => {
        cancelled = true;
      };
    }
    computeSeqRef.current += 1;
    const seq = computeSeqRef.current;
    const isCurrent = () => generation === generationRef.current && seq === computeSeqRef.current;
    computeResults(key.queryEmbedding).then(
      (next) => {
        if (isCurrent()) setComputed(next);
      },
      (e: unknown) => {
        if (!isCurrent()) return;
        setError(toError(e));
        setSearchPhase("error");
      }
    );
  }, [
    searchPhase,
    computed,
    papers,
    scoreThreshold,
    limit,
    computeResults,
    getSearchSource,
    sourceReadySignal,
  ]);

  const search = useCallback(
    async (query: string, editedQuery?: ExpandedQuery): Promise<SearchResult[]> => {
      const generation = startGeneration();
      const isCurrent = () => generation === generationRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      lastAttemptRef.current = { via: "api", query, editedQuery };

      // 前回の検索結果は確定するまで保持する（検索中・失敗時は「前回の結果」として表示する）
      beginSearch("requesting");
      // 検索APIの応答後（全件準備待ち・計算中）に失敗したときの stub 用
      let nextShown: Omit<ShownSearch, "isStub"> | null = null;

      try {
        // API key を復号化して取得（早期開始パターン）
        const apiKeyPromise = getDecryptedApiKey();
        const apiKey = await apiKeyPromise;
        if (!isCurrent()) return [];

        // 1. 検索APIを呼び出す（型安全なfetchラッパー経由）
        const data = await searchApi(
          editedQuery ? { query, limit, embeddingText: editedQuery.searchText } : { query, limit },
          { apiKey, signal: controller.signal }
        );
        // クリアや後続検索で無効化された応答は採用しない
        if (!isCurrent()) return [];

        // 2. queryEmbeddingを取得（オプショナル対応）
        const embedding =
          "queryEmbedding" in data && Array.isArray(data.queryEmbedding) ? data.queryEmbedding : [];

        // 3. 全件の準備を待って索引で計算し、確定した結果を返す（queryEmbeddingがない場合は空）。
        // 拡張クエリ（編集した検索文の場合は、サーバーが実際に Embedding した searchText）は確定時に反映する
        nextShown = {
          query,
          expandedQuery: editedQuery
            ? { ...editedQuery, searchText: data.expandedQuery.searchText }
            : data.expandedQuery,
          queryEmbedding: embedding.length > 0 ? embedding : null,
        };
        // ここから先の失敗（全件準備・計算）の再試行では、得られた拡張クエリと Embedding を使い検索APIを呼ばない
        lastAttemptRef.current = { via: "saved", ...nextShown };
        return await settleSearch(generation, nextShown);
      } catch (e) {
        if (!isCurrent()) return [];
        const err = toError(e);
        // 前回の結果がなければ、復号失敗時も「検索したが0件」として空メッセージを表示するため stub をセット
        // （論文の読み込み失敗は検索APIの応答後に起きるため、その拡張クエリを使う）。
        // 自動では再試行しない（利用不可・認証・上限の失敗を繰り返さないため。再試行は利用者の操作で行う）
        failSearch(
          err,
          err.name === "OperationError"
            ? {
                query,
                expandedQuery: editedQuery ?? {
                  original: query,
                  english: query,
                  synonyms: [],
                  searchText: query,
                },
                queryEmbedding: null,
              }
            : nextShown
        );
        return [];
      } finally {
        if (isCurrent()) {
          abortControllerRef.current = null;
        }
      }
    },
    [limit, settleSearch, startGeneration, beginSearch, failSearch]
  );

  /** 保存済み（または得られた）拡張クエリと Embedding で索引の計算だけを行う（APIリクエストなし） */
  const runWithSavedData = useCallback(
    async (
      savedExpandedQuery: ExpandedQuery,
      savedQueryEmbedding: number[] | null,
      query: string
    ): Promise<SearchResult[]> => {
      // 実行中のAPI検索があれば無効化する（後から届いた応答で履歴の結果を上書きさせない）
      const generation = startGeneration();
      lastAttemptRef.current = {
        via: "saved",
        query,
        expandedQuery: savedExpandedQuery,
        queryEmbedding: savedQueryEmbedding,
      };
      // 保存済みデータの結果は全件の準備後に索引で計算し、確定したときに表示を置き換える
      const nextShown = {
        query,
        expandedQuery: savedExpandedQuery,
        queryEmbedding: savedQueryEmbedding,
      };
      beginSearch(getSearchSource().isReady() ? "computing" : "waiting-for-papers");

      try {
        return await settleSearch(generation, nextShown);
      } catch (e) {
        if (generation !== generationRef.current) return [];
        failSearch(toError(e), nextShown);
        return [];
      }
    },
    [settleSearch, startGeneration, beginSearch, failSearch, getSearchSource]
  );

  /**
   * 保存済みのexpandedQueryとqueryEmbeddingを使って検索する
   * 検索履歴から再検索する際に使用（APIリクエストなし）
   */
  const searchWithSavedData = useCallback(
    (
      savedExpandedQuery: ExpandedQuery,
      savedQueryEmbedding: number[],
      query: string = savedExpandedQuery.original
    ): Promise<SearchResult[]> => runWithSavedData(savedExpandedQuery, savedQueryEmbedding, query),
    [runWithSavedData]
  );

  const retry = useCallback(
    (query: string): Promise<SearchResult[]> | null => {
      const attempt = lastAttemptRef.current;
      // 中止・クリアした検索や、別のクエリの試行はやり直さない（別のクエリの結果で履歴を上書きしないため）
      if (attempt === null || attempt.query !== query) return null;
      return attempt.via === "api"
        ? search(attempt.query, attempt.editedQuery)
        : runWithSavedData(attempt.expandedQuery, attempt.queryEmbedding, attempt.query);
    },
    [search, runWithSavedData]
  );

  // 表示中の結果（stub を除く）。新しい検索の実行中・失敗時は前回の検索の確定結果
  const shownResults = shown !== null && !shown.isStub && computed !== null ? computed : null;
  const isLoading =
    searchPhase === "requesting" ||
    searchPhase === "waiting-for-papers" ||
    searchPhase === "computing";
  const isShowingPreviousResults = shownResults !== null && (isLoading || searchPhase === "error");

  const cancel = useCallback(() => {
    startGeneration();
    // 中止した検索は再試行の対象にしない。前回の結果に戻るなら、その結果の条件を再試行の対象にする
    lastAttemptRef.current =
      shownResults !== null && shown !== null
        ? {
            via: "saved",
            query: shown.query,
            expandedQuery: shown.expandedQuery,
            queryEmbedding: shown.queryEmbedding,
          }
        : null;
    setError(null);
    // 前回の結果があればその確定状態に戻す（論文更新への追従も再開する）
    setSearchPhase(shownResults !== null ? "done" : "idle");
    if (shownResults === null) {
      setShown(null);
      setComputed(null);
    }
  }, [startGeneration, shownResults, shown]);

  const reset = useCallback(() => {
    startGeneration();
    lastAttemptRef.current = null;
    setSearchPhase("idle");
    setShown(null);
    setComputed(null);
    setError(null);
  }, [startGeneration]);

  // 現在の検索の結果が全件に対して確定したか（前回の結果を表示している間は確定していない）
  const resultsReady = searchPhase === "done" && shownResults !== null;
  // 表示する結果は確定した結果か前回の結果（部分集合は保持しない。確定したものだけを置き換える）
  const settled = resultsReady || isShowingPreviousResults ? shownResults : null;

  return {
    search,
    searchWithSavedData,
    results: settled?.results ?? EMPTY_RESULTS,
    papersExcludedFromSearch: settled?.excluded ?? EMPTY_PAPERS,
    isLoading,
    isWaitingForPapers: searchPhase === "waiting-for-papers",
    resultsReady,
    searchPhase,
    error,
    expandedQuery,
    queryEmbedding,
    totalMatchCount: settled?.totalMatchCount ?? 0,
    resultsScoreThreshold: settled?.key.scoreThreshold ?? null,
    resultQuery: shownResults !== null && shown !== null ? shown.query : null,
    isShowingPreviousResults,
    cancel,
    retry,
    reset,
  };
};
