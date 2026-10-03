import type { MutableRefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { MAX_QUERY_LENGTH } from "../../shared/schemas/search";

/**
 * URL の q パラメータを監視し、まだ開始していないクエリのときだけ検索を開始する。
 * effect 内では URL を更新しない（読み取り専用）。
 *
 * 入力・履歴からの検索は activeQueryRef を更新してから URL を変えるため、ここでは再実行しない。
 * 検索は urlQuery が変わったとき（と、マウント時）だけ判定する。startSearch は最新の参照を ref 経由で呼び、
 * effect の依存に含めない。論文・履歴・閾値の更新で startSearch の参照が変わっても判定をやり直さないため、
 * クリア直後（URL 更新の transition が未確定で q が残り、activeQueryRef だけ null の間）に再検索しない（#81）。
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
  const startSearchRef = useRef(startSearch);
  useLayoutEffect(() => {
    startSearchRef.current = startSearch;
  });

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
    startSearchRef.current(trimmed);
  }, [urlQuery, activeQueryRef]);
};
