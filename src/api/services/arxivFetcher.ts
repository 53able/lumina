import { format, subDays } from "date-fns";
import { parseISO } from "date-fns";
import type { Paper } from "../../shared/schemas/index";
import type { SyncPeriod } from "../../shared/schemas/index";

/**
 * arXiv API クエリオプション
 */
export interface ArxivQueryOptions {
  /** 取得対象のカテゴリ */
  categories: string[];
  /** 最大取得件数 */
  maxResults: number;
  /** 開始位置（ページング用） */
  start?: number;
  /** 同期期間（日数） */
  period?: SyncPeriod;
}

/**
 * arXiv API レスポンス
 */
export interface ArxivFetchResult {
  /** 取得した論文データ */
  papers: Paper[];
  /** 全件数 */
  totalResults: number;
}

/**
 * arXiv APIのベースURL
 */
const ARXIV_API_URL = "http://export.arxiv.org/api/query";

/**
 * XMLからテキストを抽出するヘルパー
 */
const extractText = (xml: string, tag: string): string => {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1]?.trim() ?? "";
};

/**
 * XMLから複数のタグ値を抽出するヘルパー
 */
const extractAllText = (xml: string, tag: string): string[] => {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  return Array.from(xml.matchAll(regex), (m) => (m[1] ?? "").trim());
};

/**
 * XMLからカテゴリを抽出するヘルパー
 */
const extractCategories = (xml: string): string[] => {
  const regex = /<category\s+term="([^"]+)"/gi;
  return Array.from(xml.matchAll(regex), (m) => m[1]);
};

/**
 * XMLからリンクを抽出するヘルパー
 */
const extractLink = (xml: string, rel: string, type?: string): string => {
  const typePattern = type ? `\\s+type="${type}"` : "";
  const regex = new RegExp(`<link[^>]*rel="${rel}"${typePattern}[^>]*href="([^"]*)"`, "i");
  const match = xml.match(regex);
  if (match?.[1]) return match[1];

  // hrefが先に来る場合
  const regex2 = new RegExp(`<link[^>]*href="([^"]*)"[^>]*rel="${rel}"`, "i");
  const match2 = xml.match(regex2);
  return match2?.[1] ?? "";
};

/**
 * arXiv IDを抽出する
 * 新形式: http://arxiv.org/abs/2401.12345v1 → 2401.12345
 * 旧形式: http://arxiv.org/abs/math.GT/0309136v2 → math.GT/0309136
 */
const extractArxivId = (url: string): string => {
  // URLからabs/以降を取得
  const absMatch = url.match(/abs\/(.+)$/);
  const idWithVersion = absMatch?.[1];
  if (!idWithVersion) return url;

  // バージョン番号を除去 (v1, v2, etc.)
  return idWithVersion.replace(/v\d+$/, "");
};

/**
 * arXiv APIレスポンスの1エントリをPaperオブジェクトにパースする
 */
export const parseArxivEntry = (entryXml: string): Paper => {
  const idUrl = extractText(entryXml, "id");
  const id = extractArxivId(idUrl);

  const title = extractText(entryXml, "title").replace(/\s+/g, " ");
  const abstract = extractText(entryXml, "summary").replace(/\s+/g, " ");
  const authors = extractAllText(entryXml, "name");
  const categories = extractCategories(entryXml);

  const publishedAt = parseISO(extractText(entryXml, "published"));
  const updatedAt = parseISO(extractText(entryXml, "updated"));

  const arxivUrl = extractLink(entryXml, "alternate", "text/html");
  const pdfUrl = extractLink(entryXml, "related", "application/pdf");

  return {
    id,
    title,
    abstract,
    authors,
    categories,
    publishedAt,
    updatedAt,
    pdfUrl,
    arxivUrl,
  };
};

/**
 * 日付をarXiv API形式（YYYYMMDDHHMMSS）に変換する
 * @param date 変換対象の日付
 * @returns arXiv API形式の日付文字列（例: "20260127*"）
 */
const formatArxivDate = (date: Date): string => {
  return format(date, "yyyyMMdd") + "*";
};

/**
 * 同期期間から開始日を計算する
 * @param period 同期期間（日数）
 * @returns 開始日のDateオブジェクト
 */
const getPeriodStartDate = (period: SyncPeriod): Date => {
  const days = Number.parseInt(period, 10);
  return subDays(new Date(), days);
};

/**
 * arXiv API用のクエリ文字列をエンコードする
 * arXiv APIでは + がスペースとして解釈されるため、encodeURIComponent の後に + を復元する
 * また、ブラケット [ ] はエンコードしない（arXiv APIの仕様）
 * @param query クエリ文字列
 * @returns エンコードされたクエリ文字列
 */
const encodeArxivQuery = (query: string): string => {
  // まず特殊文字をエンコード
  let encoded = encodeURIComponent(query);
  // スペース（%20）を + に変換（arXiv APIでは + がスペースとして解釈される）
  encoded = encoded.replace(/%20/g, "+");
  // 既存の + をスペースとして扱うために %2B を + に戻す
  encoded = encoded.replace(/%2B/g, "+");
  // ブラケット [ ] をデコード（arXiv APIが期待する形式）
  encoded = encoded.replace(/%5B/g, "[").replace(/%5D/g, "]");
  return encoded;
};

/**
 * arXiv API用のクエリ文字列を構築する
 * @param categories カテゴリ配列
 * @param period 同期期間（オプショナル、現在は使用しない - arXiv APIの日付範囲クエリが不安定なため）
 * @returns arXiv API用のクエリ文字列
 */
const buildSearchQuery = (categories: string[], period?: SyncPeriod): string => {
  // カテゴリをOR条件で結合
  // cat:cs.AI OR cat:cs.LG
  const categoryQuery = categories.map((cat) => `cat:${cat}`).join("+OR+");

  // 注意: arXiv APIの日付範囲クエリは不安定なため、日付フィルタは使用しない
  // 代わりに、クライアント側で publishedAt または updatedAt でフィルタリングする
  // これにより、arXiv APIの制限を回避しつつ、期間内の論文を取得できる

  return categoryQuery;
};

/**
 * arXiv APIから論文データを取得する
 */
export const fetchArxivPapers = async (options: ArxivQueryOptions): Promise<ArxivFetchResult> => {
  const { categories, maxResults, start = 0, period } = options;

  const searchQuery = buildSearchQuery(categories, period);
  const encodedQuery = encodeArxivQuery(searchQuery);
  const url = `${ARXIV_API_URL}?search_query=${encodedQuery}&start=${start}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    // エラーメッセージ全体を取得（XMLパースしてエラーメッセージを抽出）
    const errorMatch = errorText.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const errorMessage = errorMatch?.[1]?.trim() || errorText.substring(0, 1000);
    throw new Error(`arXiv API error: ${response.status} ${response.statusText} - ${errorMessage}`);
  }

  const xml = await response.text();

  // totalResultsを抽出
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i);
  const totalResults = totalMatch?.[1] ? Number.parseInt(totalMatch[1], 10) : 0;

  // エントリを抽出してパース
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let papers = Array.from(xml.matchAll(entryRegex), (m) => parseArxivEntry(m[1] ?? ""));

  // 期間指定がある場合は、クライアント側でフィルタリング
  if (period) {
    const startDate = getPeriodStartDate(period);
    const endDate = new Date();
    papers = papers.filter((paper) => {
      // publishedAt または updatedAt が期間内にあるかチェック
      const paperDate = paper.updatedAt > paper.publishedAt ? paper.updatedAt : paper.publishedAt;
      return paperDate >= startDate && paperDate <= endDate;
    });
  }

  return {
    papers,
    totalResults,
  };
};
