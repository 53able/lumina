import type { MutableRefObject } from "react";
import { useEffect } from "react";
import type { ExpandedQuery, SearchHistory } from "../../shared/schemas/index";

/**
 * 検索が完了したタイミングで、検索履歴に1件追加する。
 * expandedQuery と queryEmbedding が揃い、lastSearchQueryRef にクエリが記録されているときのみ追加し、追加後に ref をリセットする。
 *
 * @param expandedQuery - 直近の拡張クエリ（null のときは未完了）
 * @param queryEmbedding - 直近のクエリ Embedding
 * @param totalMatchCount - ヒット総数（履歴の resultCount 用）
 * @param lastSearchQueryRef - 最後に検索したクエリを保持する ref（呼び出し元が所有）
 * @param addHistory - 履歴追加関数
 */
export const useSearchHistorySync = (
  expandedQuery: ExpandedQuery | null,
  queryEmbedding: number[] | null,
  totalMatchCount: number,
  lastSearchQueryRef: MutableRefObject<string | null>,
  addHistory: (history: SearchHistory) => Promise<void>
): void => {
  useEffect(() => {
    if (!expandedQuery || !queryEmbedding || lastSearchQueryRef.current === null) return;

    const history: SearchHistory = {
      id: crypto.randomUUID(),
      originalQuery: lastSearchQueryRef.current,
      expandedQuery,
      queryEmbedding,
      resultCount: totalMatchCount,
      createdAt: new Date(),
    };
    addHistory(history);
    lastSearchQueryRef.current = null;
  }, [expandedQuery, queryEmbedding, totalMatchCount, addHistory, lastSearchQueryRef]);
};
