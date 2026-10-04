import { useCallback, useEffect, useRef, useState } from "react";
import type { ExpandedQuery, Paper, SearchHistory } from "../../shared/schemas/index";
import type { PaperSearchSource } from "../lib/paperIndex/core";
import { usePaperFilter } from "./usePaperFilter";
import { useSearchFromUrl } from "./useSearchFromUrl";
import { useSearchHistorySync } from "./useSearchHistorySync";
import { useSemanticSearch } from "./useSemanticSearch";

interface UseHomeSearchOptions {
  /** 検索対象の論文配列 */
  papers: Paper[];
  /** 類似度スコアの閾値 */
  scoreThreshold?: number;
  /** 検索完了時に履歴へ追加する関数 */
  addHistory: (history: SearchHistory) => Promise<void>;
  /** クエリに一致する保存済み履歴を返す（URL 起点でも保存済み Embedding を使い API を省くため） */
  findSavedHistory?: (query: string) => SearchHistory | undefined;
  /** 検索の実行元（既定は paperStore の索引。テストで差し替える） */
  searchSource?: PaperSearchSource;
}

/** 保存済み Embedding を持つ履歴か */
const hasSavedEmbedding = (
  history: SearchHistory | undefined
): history is SearchHistory & { queryEmbedding: number[] } =>
  history?.queryEmbedding != null && history.queryEmbedding.length > 0;

/**
 * useHomeSearch - ホーム画面の検索入口（入力・URL・履歴）を1つの実行経路にまとめるフック
 *
 * 1回の利用者操作を1回の検索実行として扱うため、検索を開始した入口が
 * activeQueryRef に「実行中・実行済みのクエリ」を記録してから URL を更新する。
 * URL 監視（useSearchFromUrl）は activeQueryRef と異なるクエリのときだけ検索する
 * （URL 直接訪問・外部からの URL 変更・画面への復帰用）。
 *
 * - 入力からの検索: URL 更新 + API 検索
 * - 履歴からの再検索・URL 起点の検索: 保存済み Embedding があれば API なしで検索
 * - クリア: 実行中の検索を無効化し、URL 由来の検索も再開しない
 * - 変換文の編集からの再検索: URL の q（元の入力）は変えず、編集文を Embedding して検索する。
 *   履歴は元の入力をキーに、編集後の検索文と Embedding で上書きする（編集前の検索文は originalSearchText に残す）
 * - 検索中・失敗時: 入力と前回の結果を保持する（previousResultsQuery で「前回の結果」と区別する）
 * - 中止・前回の結果に戻る: 実行中の検索を無効化し、URL・表示クエリを前回の結果のクエリに戻す（入力欄は保持する）
 * - 再試行: 失敗した検索を同じ条件で1回だけ実行する（利用者の操作でのみ行い、自動では再試行しない）
 *
 * URL の q は setSearchParams が render 時点の値から次の値を作るため、
 * 1つのハンドラー内で複数回更新しない（クリア時の q 削除は呼び出し元の clearSearchAndFilters が担う）。
 */
export const useHomeSearch = ({
  papers,
  scoreThreshold,
  addHistory,
  findSavedHistory,
  searchSource,
}: UseHomeSearchOptions) => {
  const semanticSearch = useSemanticSearch({ papers, scoreThreshold, searchSource });
  const {
    search,
    searchWithSavedData,
    reset,
    cancel,
    expandedQuery,
    queryEmbedding,
    totalMatchCount,
    resultsReady,
    resultQuery,
    isShowingPreviousResults,
  } = semanticSearch;

  const { searchQuery, setSearchQuery } = usePaperFilter();
  const urlQuery = searchQuery ?? "";

  // 検索入力欄の値（履歴クリックで反映・クリアで空にする）
  const [searchInputValue, setSearchInputValue] = useState("");

  // 最後に検索したクエリを追跡（履歴追加用）
  const lastSearchQueryRef = useRef<string | null>(null);
  // 現在の検索として開始済みのクエリ（URL 同期による重複実行の防止用）
  const activeQueryRef = useRef<string | null>(null);
  // 表示用の現在のクエリ（LLM が返す expandedQuery.original は入力と一致する保証がないため使わない）
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  // 編集文で再検索した拡張クエリ。検索中・失敗時（expandedQuery が null）もエディタに編集内容を残すために使う
  const [editedQuery, setEditedQuery] = useState<ExpandedQuery | null>(null);

  useSearchHistorySync(
    expandedQuery,
    queryEmbedding,
    totalMatchCount,
    resultsReady,
    lastSearchQueryRef,
    addHistory
  );

  /** 検索を開始したクエリを記録する（履歴追加・重複防止・表示用） */
  const beginQuery = useCallback((query: string) => {
    activeQueryRef.current = query;
    lastSearchQueryRef.current = query;
    setActiveQuery(query);
  }, []);

  /** 保存済み Embedding があれば API なしで、なければ API で検索する */
  const runQuery = useCallback(
    (query: string, history: SearchHistory | undefined) => {
      if (hasSavedEmbedding(history)) {
        void searchWithSavedData(history.expandedQuery, history.queryEmbedding, query);
      } else {
        void search(query);
      }
    },
    [search, searchWithSavedData]
  );

  /** URL（直接訪問・画面への復帰）からの検索 */
  const handleSearchFromUrl = useCallback(
    (query: string) => {
      beginQuery(query);
      setEditedQuery(null);
      setSearchInputValue(query);
      runQuery(query, findSavedHistory?.(query));
    },
    [beginQuery, runQuery, findSavedHistory]
  );

  // アンマウント時は useSemanticSearch が実行中の検索を無効化するため、開始済みの記録も消す
  // （StrictMode の再マウントや画面復帰で、URL 起点の検索をやり直せるようにする）
  useEffect(
    () => () => {
      activeQueryRef.current = null;
    },
    []
  );

  useSearchFromUrl(urlQuery, handleSearchFromUrl, activeQueryRef);

  /** 検索入力（ボタン／Enter）からの検索 */
  const handleSearch = useCallback(
    async (query: string): Promise<Paper[]> => {
      beginQuery(query);
      setEditedQuery(null);
      setSearchQuery(query);
      const searchResults = await search(query);
      return searchResults.map((r) => r.paper);
    },
    [beginQuery, search, setSearchQuery]
  );

  /**
   * 検索文エディタ・検索クエリ表示用の拡張クエリ。前回の結果を表示している間（新しい検索の実行中・失敗時）は
   * 前回の拡張クエリを新しい検索のものとして出さず、編集文での再検索なら送信した編集内容を返す（エディタを消さない）
   */
  const displayExpandedQuery = isShowingPreviousResults
    ? editedQuery
    : (expandedQuery ?? editedQuery);

  /**
   * 確認・編集した変換文（Embedding に渡す検索文）で再検索する。
   * 元の入力（URL の q・入力欄・表示クエリ）は保持し、クエリ拡張は行わない。
   * 編集前の検索文は originalSearchText に引き継ぐ（履歴にも残り「元の検索文に戻す」に使う）。
   */
  const handleSearchWithEditedText = useCallback(
    (searchText: string) => {
      const query = activeQueryRef.current;
      const base = displayExpandedQuery;
      if (query === null || base === null) return;
      const nextQuery: ExpandedQuery = {
        ...base,
        searchText,
        originalSearchText: base.originalSearchText ?? base.searchText,
      };
      beginQuery(query);
      setEditedQuery(nextQuery);
      void search(query, nextQuery);
    },
    [beginQuery, displayExpandedQuery, search]
  );

  /**
   * 実行中の検索を中止する・失敗した検索から前回の結果に戻る。
   * 通信を中止して応答を採用せず（履歴にも追加しない）、URL の q・表示クエリを前回の結果のクエリに戻す。
   * 前回の結果がなければ検索していない状態に戻す。入力欄の内容は消さない（条件を直して検索し直せるように）。
   */
  const handleCancelSearch = useCallback(() => {
    // 検索開始と同じ操作の中で呼ばれても（描画前の値でも）、前回の結果のクエリは resultQuery で決まる
    const backTo = resultQuery;
    cancel();
    lastSearchQueryRef.current = null;
    // URL 監視が前回のクエリを新しい検索として再実行しないよう、URL より先に記録する
    activeQueryRef.current = backTo;
    setActiveQuery(backTo);
    setEditedQuery(null);
    setSearchQuery(backTo);
  }, [cancel, resultQuery, setSearchQuery]);

  /**
   * 失敗した検索を同じ条件（入力・編集した検索文）でもう一度実行する（1操作1回）。
   * 失敗していない（実行中・成功・クリア後で再試行する検索がない）ときは何もしない。
   */
  const handleRetrySearch = useCallback(() => {
    const query = activeQueryRef.current;
    if (query === null || semanticSearch.error === null) return;
    beginQuery(query);
    void search(query, editedQuery ?? undefined);
  }, [beginQuery, search, editedQuery, semanticSearch.error]);

  /** 検索をクリア（URL の q は呼び出し元がフィルターと合わせて消す） */
  const handleClearSearch = useCallback(() => {
    activeQueryRef.current = null;
    lastSearchQueryRef.current = null;
    setActiveQuery(null);
    setEditedQuery(null);
    setSearchInputValue("");
    reset();
  }, [reset]);

  /** 検索履歴から再検索 */
  const handleReSearch = useCallback(
    (history: SearchHistory) => {
      const query = history.originalQuery;
      // 履歴追加用にクエリを記録（既存履歴が更新される）
      beginQuery(query);
      setEditedQuery(null);
      setSearchInputValue(query);
      setSearchQuery(query);
      runQuery(query, history);
    },
    [beginQuery, runQuery, setSearchQuery]
  );

  return {
    ...semanticSearch,
    /**
     * 結果が揃った検索のクエリ（検索中・保存済み論文の全件準備待ち・クリア後は null）。
     * 失敗した検索（キー復号失敗など）は理由を表示するため、拡張クエリがあればクエリを返す
     */
    completedQuery:
      expandedQuery !== null &&
      !isShowingPreviousResults &&
      (resultsReady || semanticSearch.error !== null)
        ? activeQuery
        : null,
    /** 前回の結果を表示している間（新しい検索の実行中・失敗時）、その結果を得た検索のクエリ。それ以外は null */
    previousResultsQuery: isShowingPreviousResults ? resultQuery : null,
    /** 実行中・失敗した検索のクエリ（検索欄近くの状態表示用。それ以外は null） */
    pendingQuery: semanticSearch.isLoading || semanticSearch.error !== null ? activeQuery : null,
    /** API利用OFFで止まった検索の確定クエリ（入力欄の編集では変わらない。それ以外は null） */
    stoppedQuery:
      semanticSearch.error?.name === "ApiDisabledError" ? (activeQuery?.trim() ?? null) : null,
    searchInputValue,
    setSearchInputValue,
    handleSearch,
    handleClearSearch,
    handleReSearch,
    /**
     * 検索クエリ表示・検索文エディタ用の拡張クエリ。完了した検索の拡張クエリを優先し、
     * 編集文での再検索中・失敗時は送信した編集内容を返す（エディタを消さず、編集内容を失わない）
     */
    displayExpandedQuery,
    handleSearchWithEditedText,
    handleCancelSearch,
    handleRetrySearch,
  };
};
