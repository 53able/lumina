import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpandedQuery, Paper } from "../../shared/schemas/index";
import { getDecryptedApiKey, searchApi } from "../lib/api";
import {
  hasPaperEmbedding,
  type PaperSearchMatches,
  type PaperSearchSource,
} from "../lib/paperIndex/core";
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
    queryEmbedding: number[]
  ) => Promise<SearchResult[]>;
  /** 検索結果（確定前は空） */
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
  /** 状態リセット関数（実行中の検索も無効化し、その応答を採用しない） */
  reset: () => void;
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
  const [expandedQuery, setExpandedQuery] = useState<ExpandedQuery | null>(null);
  const [queryEmbedding, setQueryEmbedding] = useState<number[] | null>(null);
  const [computed, setComputed] = useState<ComputedSearchResults | null>(null);
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
      const { matches, totalMatchCount } =
        embedding && embedding.length > 0
          ? await getSearchSource().search(embedding, currentThreshold, currentLimit)
          : NO_MATCHES;

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
   * 世代が変わった（クリア・後続検索）場合は反映せず空を返す。
   */
  const settleSearch = useCallback(
    async (generation: number, embedding: number[] | null): Promise<SearchResult[]> => {
      const source = getSearchSource();
      setSearchPhase(source.isReady() ? "computing" : "waiting-for-papers");
      await source.whenReady();
      if (generation !== generationRef.current) return [];

      setSearchPhase("computing");
      computeSeqRef.current += 1;
      const seq = computeSeqRef.current;
      while (true) {
        const next = await computeResults(embedding);
        if (generation !== generationRef.current || seq !== computeSeqRef.current) return [];
        // Worker の応答待ちに入力が変わったら、最新の条件で計算し直してから確定する。
        // 古い件数で done にすると、再計算前に検索履歴へ保存されてしまう。
        if (
          next.key.papers !== papersRef.current ||
          next.key.scoreThreshold !== scoreThresholdRef.current ||
          next.key.limit !== limitRef.current
        ) {
          continue;
        }

        setComputed(next);
        setSearchPhase("done");
        return next.results;
      }
    },
    [computeResults, getSearchSource]
  );

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

      // 検索開始時に前回の検索結果をクリア（検索中に「該当する論文がありませんでした」が表示されないようにする）
      setExpandedQuery(null);
      setQueryEmbedding(null);
      setComputed(null);
      setError(null);
      setSearchPhase("requesting");

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

        // 2. 拡張クエリを保存（編集した検索文の場合は、サーバーが実際に Embedding した searchText を採用する）
        setExpandedQuery(
          editedQuery
            ? { ...editedQuery, searchText: data.expandedQuery.searchText }
            : data.expandedQuery
        );

        // 3. queryEmbeddingを取得（オプショナル対応）
        const embedding =
          "queryEmbedding" in data && Array.isArray(data.queryEmbedding) ? data.queryEmbedding : [];
        const savedEmbedding = embedding.length > 0 ? embedding : null;
        setQueryEmbedding(savedEmbedding);

        // 4. 全件の準備を待って索引で計算し、確定した結果を返す（queryEmbeddingがない場合は空）
        return await settleSearch(generation, savedEmbedding);
      } catch (e) {
        if (!isCurrent()) return [];
        const err = toError(e);
        setError(err);
        setSearchPhase("error");
        // 復号失敗時も「検索したが0件」として空メッセージを表示するため stub をセット
        if (err.name === "OperationError") {
          setExpandedQuery(
            editedQuery ?? {
              original: query,
              english: query,
              synonyms: [],
              searchText: query,
            }
          );
          setQueryEmbedding(null);
        }
        return [];
      } finally {
        if (isCurrent()) {
          abortControllerRef.current = null;
        }
      }
    },
    [limit, settleSearch, startGeneration]
  );

  /**
   * 保存済みのexpandedQueryとqueryEmbeddingを使って検索する
   * 検索履歴から再検索する際に使用（APIリクエストなし）
   */
  const searchWithSavedData = useCallback(
    async (
      savedExpandedQuery: ExpandedQuery,
      savedQueryEmbedding: number[]
    ): Promise<SearchResult[]> => {
      // 実行中のAPI検索があれば無効化する（後から届いた応答で履歴の結果を上書きさせない）
      const generation = startGeneration();
      setError(null);
      setComputed(null);

      // 保存済みデータを状態に設定（結果は全件の準備後に索引で計算する）
      setExpandedQuery(savedExpandedQuery);
      setQueryEmbedding(savedQueryEmbedding);

      try {
        return await settleSearch(generation, savedQueryEmbedding);
      } catch (e) {
        if (generation !== generationRef.current) return [];
        setError(toError(e));
        setSearchPhase("error");
        return [];
      }
    },
    [settleSearch, startGeneration]
  );

  const reset = useCallback(() => {
    startGeneration();
    setSearchPhase("idle");
    setExpandedQuery(null);
    setQueryEmbedding(null);
    setComputed(null);
    setError(null);
  }, [startGeneration]);

  // 確定前（全件準備待ち・計算中）・失敗時は結果を出さない（部分集合を確定結果として扱わない）
  const resultsReady = searchPhase === "done" && computed !== null;
  const settled = resultsReady ? computed : null;

  return {
    search,
    searchWithSavedData,
    results: settled?.results ?? EMPTY_RESULTS,
    papersExcludedFromSearch: settled?.excluded ?? EMPTY_PAPERS,
    isLoading:
      searchPhase === "requesting" ||
      searchPhase === "waiting-for-papers" ||
      searchPhase === "computing",
    isWaitingForPapers: searchPhase === "waiting-for-papers",
    resultsReady,
    searchPhase,
    error,
    expandedQuery,
    queryEmbedding,
    totalMatchCount: settled?.totalMatchCount ?? 0,
    resultsScoreThreshold: settled?.key.scoreThreshold ?? null,
    reset,
  };
};
