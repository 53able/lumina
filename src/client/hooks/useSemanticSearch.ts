import { useCallback, useMemo, useState } from "react";
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
  /** 検索関数（結果を直接返す） */
  search: (query: string) => Promise<SearchResult[]>;
  /** 保存済みデータで検索する関数（APIリクエストなし） */
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
  /** 状態リセット関数 */
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

  // reduce で累積計算（参照透過性を保持）
  // 注: a.length === b.length は上で検証済み
  const { dotProduct, normA, normB } = a.reduce(
    (acc, ai, i) => {
      const bi = b[i] ?? 0;
      return {
        dotProduct: acc.dotProduct + ai * bi,
        normA: acc.normA + ai * ai,
        normB: acc.normB + bi * bi,
      };
    },
    { dotProduct: 0, normA: 0, normB: 0 }
  );

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

/** 検索結果の内部 state（paper は papers から解決するため id + score のみ保持） */
interface ResultEntry {
  paperId: string;
  score: number;
}

export const useSemanticSearch = ({
  papers,
  limit = 20,
  scoreThreshold = DEFAULT_SCORE_THRESHOLD,
}: UseSemanticSearchOptions): UseSemanticSearchReturn => {
  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([]);
  const [papersExcludedFromSearch, setPapersExcludedFromSearch] = useState<Paper[]>([]);
  const [totalMatchCount, setTotalMatchCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [expandedQuery, setExpandedQuery] = useState<ExpandedQuery | null>(null);
  const [queryEmbedding, setQueryEmbedding] = useState<number[] | null>(null);

  // ストア（papers）から paper を解決し、リアクティブに results を導出
  const results = useMemo(
    () =>
      resultEntries
        .map((e) => {
          const paper = papers.find((p) => p.id === e.paperId);
          return paper ? ({ paper, score: e.score } as SearchResult) : null;
        })
        .filter((r): r is SearchResult => r != null),
    [resultEntries, papers]
  );

  /**
   * 共通の検索ロジック: Embeddingベクトルから検索結果を計算する
   * @param queryEmbedding クエリのEmbeddingベクトル
   * @returns 検索結果の配列
   */
  const computeSearchResults = useCallback(
    (queryEmbedding: number[]): SearchResult[] => {
      // Embeddingなし論文を検索対象外として保持（常時可視化用）
      const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
      setPapersExcludedFromSearch(excluded);

      // 論文ID → Paper のマップを作成（O(1)ルックアップ用）
      const paperMap = new Map(papers.map((p) => [p.id, p]));

      // ローカルの論文とコサイン類似度を計算
      const searchResults: SearchResult[] = [];

      for (const paper of papers) {
        // embeddingがない論文はスキップ
        if (!paper.embedding || paper.embedding.length === 0) {
          continue;
        }

        const score = cosineSimilarity(queryEmbedding, paper.embedding);
        searchResults.push({
          paper: {
            id: paper.id,
            title: paper.title,
            abstract: paper.abstract,
            authors: paper.authors,
            categories: paper.categories,
            publishedAt: paper.publishedAt,
            updatedAt: paper.updatedAt,
            pdfUrl: paper.pdfUrl,
            arxivUrl: paper.arxivUrl,
          },
          score,
        });
      }

      // 類似度順にソート（降順）
      // React Best Practice: スプレッド演算子でイミュータブルにソート（元の配列を変更しない）
      const sortedResults = [...searchResults].sort((a, b) => b.score - a.score);

      // 閾値でフィルタリング（関連性の低い結果を除外）
      const filteredResults = sortedResults.filter((r) => r.score >= scoreThreshold);

      // limitを適用して上位N件に絞り込む
      const limitedResults = filteredResults.slice(0, limit);

      // ヒット総数（limit適用前）を保存し、結果を保存（id + score のみ）
      setTotalMatchCount(filteredResults.length);
      setResultEntries(limitedResults.map((r) => ({ paperId: r.paper.id, score: r.score })));

      // ストアから最新のpaperを解決して返す（MapでO(1)ルックアップ）
      return limitedResults.map((r) => ({
        paper: paperMap.get(r.paper.id) ?? r.paper,
        score: r.score,
      }));
    },
    [papers, limit, scoreThreshold]
  );

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      setIsLoading(true);
      setError(null);
      // 検索開始時に前回の検索結果をクリア（検索中に「該当する論文がありませんでした」が表示されないようにする）
      setExpandedQuery(null);
      setQueryEmbedding(null);
      setResultEntries([]);
      setPapersExcludedFromSearch([]);
      setTotalMatchCount(0);

      try {
        // API key を復号化して取得（早期開始パターン）
        const apiKeyPromise = getDecryptedApiKey();
        const apiKey = await apiKeyPromise;

        // 1. 検索APIを呼び出す（型安全なfetchラッパー経由）
        const data = await searchApi({ query, limit }, { apiKey });

        // 2. 拡張クエリを保存
        setExpandedQuery(data.expandedQuery);

        // 3. queryEmbeddingを取得（オプショナル対応）
        const embedding =
          "queryEmbedding" in data && Array.isArray(data.queryEmbedding) ? data.queryEmbedding : [];

        // queryEmbeddingを状態に保存
        setQueryEmbedding(embedding.length > 0 ? embedding : null);

        // queryEmbeddingがない場合は結果を空にする
        if (embedding.length === 0) {
          setResultEntries([]);
          setTotalMatchCount(0);
          const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
          setPapersExcludedFromSearch(excluded);
          return [];
        }

        // 4. 共通ロジックで検索結果を計算
        return computeSearchResults(embedding);
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        setResultEntries([]);
        setTotalMatchCount(0);
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
        setIsLoading(false);
      }
    },
    [papers, limit, computeSearchResults]
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
      setIsLoading(true);
      setError(null);
      // 検索開始時に前回の検索結果をクリア（検索中に「該当する論文がありませんでした」が表示されないようにする）
      setResultEntries([]);
      setPapersExcludedFromSearch([]);
      setTotalMatchCount(0);

      try {
        // 保存済みデータを状態に設定
        setExpandedQuery(savedExpandedQuery);
        setQueryEmbedding(savedQueryEmbedding);

        // queryEmbeddingがない場合は結果を空にする
        if (savedQueryEmbedding.length === 0) {
          setResultEntries([]);
          setTotalMatchCount(0);
          const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
          setPapersExcludedFromSearch(excluded);
          return [];
        }

        // 共通ロジックで検索結果を計算
        return computeSearchResults(savedQueryEmbedding);
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        setResultEntries([]);
        setTotalMatchCount(0);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [papers, computeSearchResults]
  );

  const reset = useCallback(() => {
    setResultEntries([]);
    setPapersExcludedFromSearch([]);
    setTotalMatchCount(0);
    setExpandedQuery(null);
    setQueryEmbedding(null);
    setError(null);
  }, []);

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
