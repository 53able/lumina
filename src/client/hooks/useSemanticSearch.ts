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

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      setIsLoading(true);
      setError(null);

      try {
        // API key を復号化して取得
        const apiKey = await getDecryptedApiKey();

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
          const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
          setPapersExcludedFromSearch(excluded);
          return [];
        }

        // Embeddingなし論文を検索対象外として保持（常時可視化用）
        const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
        setPapersExcludedFromSearch(excluded);

        // 4. ローカルの論文とコサイン類似度を計算
        const searchResults: SearchResult[] = [];

        for (const paper of papers) {
          // embeddingがない論文はスキップ
          if (!paper.embedding || paper.embedding.length === 0) {
            continue;
          }

          const score = cosineSimilarity(embedding, paper.embedding);
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

        // 5. 類似度順にソート（降順）
        searchResults.sort((a, b) => b.score - a.score);

        // 6. 閾値でフィルタリング（関連性の低い結果を除外）
        const filteredResults = searchResults.filter((r) => r.score >= scoreThreshold);

        // 7. limitを適用して上位N件に絞り込む
        const limitedResults = filteredResults.slice(0, limit);

        // 8. 結果を保存（id + score のみ）して、返り値は papers から解決した SearchResult[] を返す
        setResultEntries(limitedResults.map((r) => ({ paperId: r.paper.id, score: r.score })));
        const resolved = limitedResults.map((r) => ({
          paper: papers.find((p) => p.id === r.paper.id) ?? r.paper,
          score: r.score,
        }));
        return resolved;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        setResultEntries([]);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [papers, limit, scoreThreshold]
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

      try {
        // 保存済みデータを状態に設定
        setExpandedQuery(savedExpandedQuery);
        setQueryEmbedding(savedQueryEmbedding);

        // queryEmbeddingがない場合は結果を空にする
        if (savedQueryEmbedding.length === 0) {
          setResultEntries([]);
          const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
          setPapersExcludedFromSearch(excluded);
          return [];
        }

        const excluded = papers.filter((p) => !p.embedding || p.embedding.length === 0);
        setPapersExcludedFromSearch(excluded);

        // ローカルの論文とコサイン類似度を計算
        const searchResults: SearchResult[] = [];

        for (const paper of papers) {
          // embeddingがない論文はスキップ
          if (!paper.embedding || paper.embedding.length === 0) {
            continue;
          }

          const score = cosineSimilarity(savedQueryEmbedding, paper.embedding);
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
        searchResults.sort((a, b) => b.score - a.score);

        // 閾値でフィルタリング（関連性の低い結果を除外）
        const filteredResults = searchResults.filter((r) => r.score >= scoreThreshold);

        // limitを適用して上位N件に絞り込む
        const limitedResults = filteredResults.slice(0, limit);

        // 結果を保存（id + score のみ）して、返り値は papers から解決した SearchResult[] を返す
        setResultEntries(limitedResults.map((r) => ({ paperId: r.paper.id, score: r.score })));
        const resolved = limitedResults.map((r) => ({
          paper: papers.find((p) => p.id === r.paper.id) ?? r.paper,
          score: r.score,
        }));
        return resolved;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        setResultEntries([]);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [papers, limit, scoreThreshold]
  );

  const reset = useCallback(() => {
    setResultEntries([]);
    setPapersExcludedFromSearch([]);
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
    reset,
  };
};
