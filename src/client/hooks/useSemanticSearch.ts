import { useCallback, useState } from "react";
import { searchApi } from "@/client/lib/api";
import { useSettingsStore } from "@/client/stores/settingsStore";
import type { ExpandedQuery, Paper } from "@/shared/schemas";

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
  /** 類似度スコアの閾値（これ以下の結果は除外、デフォルト: 0.3） */
  scoreThreshold?: number;
}

/**
 * useSemanticSearchの戻り値
 */
interface UseSemanticSearchReturn {
  /** 検索関数（結果を直接返す） */
  search: (query: string) => Promise<SearchResult[]>;
  /** 検索結果 */
  results: SearchResult[];
  /** ローディング状態 */
  isLoading: boolean;
  /** エラー */
  error: Error | null;
  /** 拡張クエリ */
  expandedQuery: ExpandedQuery | null;
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

export const useSemanticSearch = ({
  papers,
  limit = 20,
  scoreThreshold = DEFAULT_SCORE_THRESHOLD,
}: UseSemanticSearchOptions): UseSemanticSearchReturn => {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [expandedQuery, setExpandedQuery] = useState<ExpandedQuery | null>(null);
  const apiKey = useSettingsStore((state) => state.apiKey);

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      setIsLoading(true);
      setError(null);

      try {
        // 1. 検索APIを呼び出す（型安全なfetchラッパー経由）
        const data = await searchApi({ query, limit }, { apiKey: apiKey || undefined });

        // 2. 拡張クエリを保存
        setExpandedQuery(data.expandedQuery);

        // 3. queryEmbeddingがない場合は結果を空にする
        if (!data.queryEmbedding || data.queryEmbedding.length === 0) {
          setResults([]);
          return [];
        }

        // 4. ローカルの論文とコサイン類似度を計算
        const queryEmbedding = data.queryEmbedding;
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

        // 5. 類似度順にソート（降順）
        searchResults.sort((a, b) => b.score - a.score);

        // 6. 閾値でフィルタリング（関連性の低い結果を除外）
        const filteredResults = searchResults.filter((r) => r.score >= scoreThreshold);

        // 7. limitを適用して上位N件に絞り込む
        const limitedResults = filteredResults.slice(0, limit);

        // 8. 結果を保存して返す
        setResults(limitedResults);
        return limitedResults;
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Unknown error");
        setError(err);
        setResults([]);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [papers, limit, scoreThreshold, apiKey]
  );

  const reset = useCallback(() => {
    setResults([]);
    setExpandedQuery(null);
    setError(null);
  }, []);

  return {
    search,
    results,
    isLoading,
    error,
    expandedQuery,
    reset,
  };
};
