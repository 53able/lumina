import type { MutableRefObject } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { MAX_QUERY_LENGTH } from "../../shared/schemas/search";

/**
 * URL の q パラメータを監視し、まだ開始していないクエリのときだけ検索を開始する。
 * effect 内では URL を更新しない（読み取り専用）。
 *
 * 入力・履歴からの検索は activeQueryRef を更新してから URL を変えるため、ここでは再実行しない。
 * 検索関数の参照が論文更新で変わっても、同じクエリを再検索しない。
 *
 * @param urlQuery - 現在の URL クエリ（searchParams.get("q") ?? ""）
 * @param startSearch - URL 起点の検索を開始する関数（入力欄への反映も含む）
 * @param activeQueryRef - 検索を開始済みのクエリを保持する ref（呼び出し元が所有）
 */
export const useSearchFromUrl = (
  urlQuery: string,
  startSearch: (query: string) => void,
  activeQueryRef: MutableRefObject<string | null>
): void => {
  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (trimmed.length === 0) {
      // URL から q が消えたら、次に同じクエリが URL に来たときは新しい検索として扱う
      activeQueryRef.current = null;
      return;
    }
    if (trimmed === activeQueryRef.current) return;
    if (trimmed.length > MAX_QUERY_LENGTH) {
      activeQueryRef.current = trimmed;
      toast.error("検索クエリは500文字以内で入力してください");
      return;
    }
    startSearch(trimmed);
  }, [urlQuery, startSearch, activeQueryRef]);
};
