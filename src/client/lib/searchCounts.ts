import { format } from "date-fns";
import type { Paper } from "../../shared/schemas/index";
import { hasPaperEmbedding, type PaperListItem } from "./paperIndex/core";

/**
 * 検索まわりの件数の定義と表示文言（Issue #69）。
 * 履歴・件数表示・検索範囲の表示で同じ名前の数値が同じ意味を持つように、名前と算出元をここで揃える。
 *
 * - 取得済み: このデバイスに保存済みの論文数（同期設定ではなく実データ）
 * - 検索対象: 取得済みのうち Embedding がある論文数（類似度を計算できる）
 * - 対象外: 取得済みのうち Embedding 未設定の論文数（類似度を計算できず、検索結果の一覧では末尾に並ぶ）
 * - 候補: 検索対象のうち類似度がしきい値以上の論文数（表示上限の適用前。useSemanticSearch の totalMatchCount）
 * - 上位: 候補のうち類似度の高い順に表示上限まで取り出した論文数（useSemanticSearch の results.length）
 * - 「N件の論文」: 一覧に表示しているカード数（上位＋対象外に、カテゴリ・いいね・ブックマークの絞り込みを適用した後）
 */

/** 取得済み論文から見た検索範囲（実データに基づく） */
export interface SearchScope {
  /** 取得済み */
  fetchedCount: number;
  /** 検索対象（Embeddingあり） */
  searchableCount: number;
  /** 対象外（Embedding未設定） */
  excludedCount: number;
  /** 取得済み論文の最も古い公開日（公開日を読めない論文しかなければ null） */
  oldestPublishedAt: Date | null;
  /** 取得済み論文の最も新しい公開日（公開日を読めない論文しかなければ null） */
  newestPublishedAt: Date | null;
  /** 取得済み論文に含まれるカテゴリ（論文数の多い順、同数は名前順） */
  categories: string[];
}

/**
 * 取得済み論文から検索範囲を集計する
 *
 * @param papers 取得済みの論文
 * @returns 検索範囲（論文が0件なら null）
 */
export const summarizeSearchScope = (papers: (Paper | PaperListItem)[]): SearchScope | null => {
  if (papers.length === 0) return null;

  let searchableCount = 0;
  let oldest = Number.POSITIVE_INFINITY;
  let newest = Number.NEGATIVE_INFINITY;
  const categoryCounts = new Map<string, number>();
  for (const paper of papers) {
    // 検索対象の判定は索引（Web Worker）・useSemanticSearch と同じ hasPaperEmbedding を使う
    if (hasPaperEmbedding(paper)) searchableCount += 1;
    const publishedAt = new Date(paper.publishedAt).getTime();
    if (!Number.isNaN(publishedAt)) {
      oldest = Math.min(oldest, publishedAt);
      newest = Math.max(newest, publishedAt);
    }
    for (const category of paper.categories) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  return {
    fetchedCount: papers.length,
    searchableCount,
    excludedCount: papers.length - searchableCount,
    oldestPublishedAt: Number.isFinite(oldest) ? new Date(oldest) : null,
    newestPublishedAt: Number.isFinite(newest) ? new Date(newest) : null,
    categories: [...categoryCounts.entries()]
      .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
      .map(([category]) => category),
  };
};

/** 検索範囲の表示で名前を出すカテゴリの数（残りは「ほかN種」） */
const SCOPE_CATEGORY_LIMIT = 3;

/** 件数の表記（桁区切り） */
const formatCount = (count: number): string => `${count.toLocaleString("ja-JP")}件`;

/**
 * 検索範囲の説明文（検索欄の近くに出す）
 *
 * 公開日は取得済み論文の最古・最新で、その間を網羅しているとは限らないため範囲（〜）では書かない。
 *
 * @example "取得済み 120件（公開日 最古 2024/01/01・最新 2024/03/31・カテゴリ cs.AI・cs.CL ほか2種）・検索対象 100件・対象外 20件（Embedding未設定）"
 */
export const formatSearchScope = (scope: SearchScope): string => {
  const { oldestPublishedAt, newestPublishedAt } = scope;
  const oldest = oldestPublishedAt ? format(oldestPublishedAt, "yyyy/MM/dd") : null;
  const newest = newestPublishedAt ? format(newestPublishedAt, "yyyy/MM/dd") : null;
  const period = oldest && newest ? `最古 ${oldest}・最新 ${newest}` : null;
  const shownCategories = scope.categories.slice(0, SCOPE_CATEGORY_LIMIT).join("・");
  const otherCategoryCount = scope.categories.length - SCOPE_CATEGORY_LIMIT;
  const categories =
    otherCategoryCount > 0 ? `${shownCategories} ほか${otherCategoryCount}種` : shownCategories;
  const range = [
    ...(period ? [`公開日 ${period}`] : []),
    ...(categories ? [`カテゴリ ${categories}`] : []),
  ].join("・");
  const excluded =
    scope.excludedCount > 0
      ? `・対象外 ${formatCount(scope.excludedCount)}（Embedding未設定）`
      : "";
  return `取得済み ${formatCount(scope.fetchedCount)}${range ? `（${range}）` : ""}・検索対象 ${formatCount(scope.searchableCount)}${excluded}`;
};

/**
 * 検索範囲の短い説明文（モバイルで折りたたみの見出しに出す）
 *
 * @example "取得済み 120件・対象外 20件"
 */
export const formatSearchScopeSummary = (scope: SearchScope): string =>
  scope.excludedCount > 0
    ? `取得済み ${formatCount(scope.fetchedCount)}・対象外 ${formatCount(scope.excludedCount)}`
    : `取得済み ${formatCount(scope.fetchedCount)}`;

/** 検索結果の件数の内訳に使う値 */
export interface SearchResultCounts {
  /** 候補（しきい値以上・表示上限の適用前） */
  candidateCount: number;
  /** 上位（表示上限の適用後） */
  topCount: number;
  /** 対象外（Embedding未設定） */
  excludedCount: number;
}

/**
 * 検索結果の件数の内訳（「N件の論文」の隣に出す）。
 * 表示上限による省略は「候補 X件のうち上位 Y件」、絞り込みによる省略は「絞り込みで Z件を非表示」と書き分ける。
 *
 * @param counts 候補・上位・対象外
 * @param hiddenByFilterCount 絞り込みで一覧から外した件数
 */
export const formatSearchResultBreakdown = (
  { candidateCount, topCount, excludedCount }: SearchResultCounts,
  hiddenByFilterCount: number
): string => {
  const parts = [
    candidateCount > topCount
      ? `候補 ${formatCount(candidateCount)}のうち上位 ${formatCount(topCount)}`
      : `候補 ${formatCount(candidateCount)}`,
  ];
  if (excludedCount > 0) {
    parts.push(`対象外 ${formatCount(excludedCount)}（Embedding未設定・末尾に表示）`);
  }
  if (hiddenByFilterCount > 0) {
    parts.push(`絞り込みで ${formatCount(hiddenByFilterCount)}を非表示`);
  }
  return parts.join("・");
};

/**
 * 履歴の resultCount が候補（totalMatchCount）を保存するようになった時点（232aa17・2026-02-01）。
 * それより前の履歴は表示上限（20件）を適用した後の件数を保存しているため、「候補」とは書かない。
 */
export const HISTORY_CANDIDATE_COUNT_SINCE = new Date("2026-02-01T19:31:52+09:00");

/**
 * 検索履歴の件数の表記。履歴の resultCount は検索完了時点の候補（totalMatchCount）で、
 * その後のしきい値変更・論文追加は反映しないため「検索時の候補」と書く。
 *
 * @param resultCount 検索履歴の resultCount
 * @param createdAt 検索履歴の作成日時
 */
export const formatHistoryResultCount = (resultCount: number, createdAt: Date): string =>
  createdAt < HISTORY_CANDIDATE_COUNT_SINCE
    ? formatCount(resultCount)
    : `検索時の候補 ${formatCount(resultCount)}`;

/** 検索履歴の件数の補足説明（title 用） */
export const describeHistoryResultCount = (createdAt: Date): string =>
  createdAt < HISTORY_CANDIDATE_COUNT_SINCE
    ? "検索した時点で表示した論文の件数です（表示上限の適用後）"
    : "検索した時点で類似度がしきい値以上だった論文の件数です。その後のしきい値の変更や論文の追加は反映していません";
