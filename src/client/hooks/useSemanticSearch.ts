import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpandedQuery, Paper } from "../../shared/schemas/index";
import { getDecryptedApiKey, searchApi } from "../lib/api";

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
 * useSemanticSearchのオプション
 */
interface UseSemanticSearchOptions {
  /** 検索対象の論文配列（embeddingはオプショナル） */
  papers: Paper[];
  /** 取得件数 */
  limit?: number;
  /** 類似度スコアの閾値（これ以下の結果は除外） */
  scoreThreshold?: number;
}

/**
 * useSemanticSearchの戻り値
 */
interface UseSemanticSearchReturn {
  /**
   * 検索関数（結果を直接返す）。
   * 返り値は呼び出し時点の papers で計算したスナップショットで、その後の論文更新には追従しない
   * （追従する結果は results / papersExcludedFromSearch / totalMatchCount を参照する）。
   */
  search: (query: string) => Promise<SearchResult[]>;
  /**
   * 保存済みデータで検索する関数（APIリクエストなし）。
   * 返り値は search と同じく呼び出し時点の papers によるスナップショット。
   */
  searchWithSavedData: (
    expandedQuery: ExpandedQuery,
    queryEmbedding: number[]
  ) => Promise<SearchResult[]>;
  /** 検索結果 */
  results: SearchResult[];
  /** 検索対象外（Embeddingなし）の論文（常時可視化用） */
  papersExcludedFromSearch: Paper[];
  /** ローディング状態 */
  isLoading: boolean;
  /** エラー */
  error: Error | null;
  /** 拡張クエリ */
  expandedQuery: ExpandedQuery | null;
  /** 現在のクエリEmbedding */
  queryEmbedding: number[] | null;
  /** 直近の検索でヒットした総件数（limit適用前。履歴の結果件数表示用） */
  totalMatchCount: number;
  /** 状態リセット関数（実行中の検索も無効化し、その応答を採用しない） */
  reset: () => void;
}

/**
 * コサイン類似度を計算する
 *
 * @param a ベクトルA
 * @param b ベクトルB
 * @returns 類似度（-1〜1）
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
};

/**
 * useSemanticSearch - セマンティック検索フック
 *
 * Design Docsに基づく機能:
 * - 検索APIを呼び出し、クエリ拡張とEmbeddingを取得
 * - ローカルの論文とコサイン類似度を計算
 * - 類似度順にソートして結果を返す
 *
 * @param options オプション
 * @returns 検索状態と操作関数
 */
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
}

/**
 * クエリEmbeddingと論文一覧から検索結果を計算する（APIリクエストなし）
 *
 * @param papers 検索対象の論文配列
 * @param queryEmbedding クエリのEmbeddingベクトル（空なら結果は空、対象外のみ算出）
 * @param scoreThreshold 類似度スコアの閾値
 * @param limit 取得件数
 * @returns 検索結果・検索対象外の論文・ヒット総数
 */
const computeSearchResults = (
  papers: Paper[],
  queryEmbedding: number[],
  scoreThreshold: number,
  limit: number
): ComputedSearchResults => {
  const excluded: Paper[] = [];
  const matchedResults: SearchResult[] = [];

  for (const paper of papers) {
    const embedding = paper.embedding;
    if (!embedding || embedding.length === 0) {
      excluded.push(paper);
      continue;
    }
    if (queryEmbedding.length === 0) continue;

    const score = cosineSimilarity(queryEmbedding, embedding);
    if (score >= scoreThreshold) {
      matchedResults.push({ paper, score });
    }
  }

  matchedResults.sort((a, b) => b.score - a.score);

  return {
    results: matchedResults.slice(0, limit),
    excluded,
    totalMatchCount: matchedResults.length,
  };
};

const EMPTY_SEARCH_RESULTS: ComputedSearchResults = {
  results: [],
  excluded: [],
  totalMatchCount: 0,
};

export const useSemanticSearch = ({
  papers,
  limit = 20,
  scoreThreshold = DEFAULT_SCORE_THRESHOLD,
}: UseSemanticSearchOptions): UseSemanticSearchReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [expandedQuery, setExpandedQuery] = useState<ExpandedQuery | null>(null);
  const [queryEmbedding, setQueryEmbedding] = useState<number[] | null>(null);

  /**
   * 検索の実行世代。検索開始・reset のたびに進め、古い世代の応答は状態へ反映しない。
   * 通信中止は補助手段で、応答の採用可否はこの世代で判定する（中止前に届いた応答も破棄するため）。
   */
  const generationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // アンマウント時（論文詳細への遷移など）は実行中の検索を中止・無効化する
  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      generationRef.current += 1;
    },
    []
  );

  /** 新しい世代を開始し、前の世代の通信を中止する */
  const startGeneration = useCallback((): number => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  /** 検索開始時に前回のエラーをクリアし、ローディング状態にする */
  const resetSearchState = useCallback(() => {
    setIsLoading(true);
    setError(null);
  }, []);

  /**
   * 検索結果は保存済みの queryEmbedding と現在の papers・閾値から導出する。
   * 検索表示中の論文追加・Embedding補完にも追従し、再計算に検索APIは使わない。
   * 検索が完了していない（expandedQuery が null）・失敗した場合は空とする。
   */
  const {
    results,
    excluded: papersExcludedFromSearch,
    totalMatchCount,
  } = useMemo(
    () =>
      expandedQuery !== null && error === null
        ? computeSearchResults(papers, queryEmbedding ?? [], scoreThreshold, limit)
        : EMPTY_SEARCH_RESULTS,
    [expandedQuery, error, papers, queryEmbedding, scoreThreshold, limit]
  );

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      const generation = startGeneration();
      const isCurrent = () => generation === generationRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 検索開始時に前回の検索結果をクリア（検索中に「該当する論文がありませんでした」が表示されないようにする）
      setExpandedQuery(null);
      setQueryEmbedding(null);
      resetSearchState();

      try {
        // API key を復号化して取得（早期開始パターン）
        const apiKeyPromise = getDecryptedApiKey();
        const apiKey = await apiKeyPromise;
        if (!isCurrent()) return [];

        // 1. 検索APIを呼び出す（型安全なfetchラッパー経由）
        const data = await searchApi({ query, limit }, { apiKey, signal: controller.signal });
        // クリアや後続検索で無効化された応答は採用しない
        if (!isCurrent()) return [];

        // 2. 拡張クエリを保存
        setExpandedQuery(data.expandedQuery);

        // 3. queryEmbeddingを取得（オプショナル対応）
        const embedding =
          "queryEmbedding" in data && Array.isArray(data.queryEmbedding) ? data.queryEmbedding : [];

        // queryEmbeddingを状態に保存（結果は queryEmbedding と papers から導出される）
        setQueryEmbedding(embedding.length > 0 ? embedding : null);

        // 4. 呼び出し元へ返す結果（呼び出し時点の papers によるスナップショット。queryEmbeddingがない場合は空）
        return computeSearchResults(papers, embedding, scoreThreshold, limit).results;
      } catch (e) {
        if (!isCurrent()) return [];
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        // 復号失敗時も「検索したが0件」として空メッセージを表示するため stub をセット
        if (err.name === "OperationError") {
          setExpandedQuery({
            original: query,
            english: query,
            synonyms: [],
            searchText: query,
          });
          setQueryEmbedding(null);
        }
        return [];
      } finally {
        if (isCurrent()) {
          abortControllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [papers, limit, scoreThreshold, resetSearchState, startGeneration]
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
      startGeneration();
      // 通信を伴わないため、前回のエラーとローディング状態だけを解除する
      setError(null);
      setIsLoading(false);

      // 保存済みデータを状態に設定（結果は queryEmbedding と papers から導出される）
      setExpandedQuery(savedExpandedQuery);
      setQueryEmbedding(savedQueryEmbedding);

      // 呼び出し元へ返す結果（呼び出し時点の papers によるスナップショット。queryEmbeddingがない場合は空）
      return computeSearchResults(papers, savedQueryEmbedding, scoreThreshold, limit).results;
    },
    [papers, limit, scoreThreshold, startGeneration]
  );

  const reset = useCallback(() => {
    startGeneration();
    setIsLoading(false);
    setExpandedQuery(null);
    setQueryEmbedding(null);
    setError(null);
  }, [startGeneration]);

  return {
    search,
    searchWithSavedData,
    results,
    papersExcludedFromSearch,
    isLoading,
    error,
    expandedQuery,
    queryEmbedding,
    totalMatchCount,
    reset,
  };
};
