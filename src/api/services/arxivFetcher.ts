import { parseISO } from "date-fns";
import type { Paper } from "../../shared/schemas/index.js";

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
 * arXiv API用のクエリ文字列を構築する
 */
const buildSearchQuery = (categories: string[]): string => {
  // カテゴリをOR条件で結合
  // cat:cs.AI OR cat:cs.LG
  return categories.map((cat) => `cat:${cat}`).join("+OR+");
};

/**
 * arXiv APIから論文データを取得する
 */
export const fetchArxivPapers = async (options: ArxivQueryOptions): Promise<ArxivFetchResult> => {
  const { categories, maxResults, start = 0 } = options;

  const searchQuery = buildSearchQuery(categories);
  const url = `${ARXIV_API_URL}?search_query=${searchQuery}&start=${start}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  // totalResultsを抽出
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i);
  const totalResults = totalMatch?.[1] ? Number.parseInt(totalMatch[1], 10) : 0;

  // エントリを抽出してパース
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  const papers = Array.from(xml.matchAll(entryRegex), (m) => parseArxivEntry(m[1] ?? ""));

  return {
    papers,
    totalResults,
  };
};
