import type { MutableRefObject } from "react";
import { useEffect } from "react";
import { toast } from "sonner";
import { MAX_QUERY_LENGTH } from "../../shared/schemas/search";

/**
 * URL の q パラメータを検索入力に反映し、ロード時に1回だけ検索を実行する。
 * effect 内では URL を更新しない（読み取り専用）。
 *
 * @param urlQuery - 現在の URL クエリ（searchParams.get("q") ?? ""）
 * @param search - 検索実行関数
 * @param setSearchInputValue - 検索入力欄の setState
 * @param lastSearchQueryRef - 履歴追加用に最後のクエリを保持する ref（呼び出し元が所有）
 */
export const useSearchFromUrl = (
  urlQuery: string,
  search: (query: string) => Promise<unknown>,
  setSearchInputValue: (value: string) => void,
  lastSearchQueryRef: MutableRefObject<string | null>
): void => {
  useEffect(() => {
    const trimmed = urlQuery.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_QUERY_LENGTH) {
      toast.error("検索クエリは500文字以内で入力してください");
      return;
    }
    setSearchInputValue(trimmed);
    lastSearchQueryRef.current = trimmed;
    void search(trimmed);
  }, [urlQuery, search, setSearchInputValue, lastSearchQueryRef]);
};
