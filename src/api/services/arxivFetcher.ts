import { parseISO, subDays } from "date-fns";
import type { Paper, SyncPeriod } from "../../shared/schemas/index.js";
import {
  ArxivHttpError,
  ArxivRateLimitError,
  ArxivServiceUnavailableError,
} from "../lib/errors.js";

export { ArxivHttpError, ArxivRateLimitError, ArxivServiceUnavailableError };

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
  /** 同期期間（日数）。fromDate / toDate 指定時は toDate なら開始日算出に使用 */
  period?: SyncPeriod;
  /** 取得範囲の開始日（YYYY-MM-DD）。指定時はこの日 00:00 UTC 〜 今日 を範囲とする */
  fromDate?: string;
  /** 取得範囲の終了日（YYYY-MM-DD）。指定時は範囲を [toDate − period, toDate] とする */
  toDate?: string;
}

/**
 * arXiv API レスポンス
 */
export interface ArxivFetchResult {
  /** 取得した論文データ */
  papers: Paper[];
  /** クエリ（カテゴリ・期間）に一致する総件数（opensearch:totalResults） */
  totalResults: number;
}

/**
 * arXiv APIのベースURL
 */
const ARXIV_API_URL = "https://export.arxiv.org/api/query";

/**
 * arXiv への送信間隔の最小値（利用規約: 3 秒に 1 リクエスト）
 */
const ARXIV_MIN_INTERVAL_MS = 3000;

/**
 * 待ち行列で待てる時間の上限（見積もり）。これを超える場合は並ばずに ArxivRateLimitError を投げる
 */
const ARXIV_MAX_WAIT_MS = 15_000;

/**
 * arXiv への fetch のタイムアウト（関数の maxDuration 60 秒に収まる値）
 */
const ARXIV_FETCH_TIMEOUT_MS = 25_000;

/**
 * arXiv 待ち行列の末尾。前のリクエストの完了（成功・失敗とも）で解決する。インスタンス内で共有する
 */
let arxivQueueTail: Promise<void> = Promise.resolve();

/**
 * 待ち行列にいる件数（実行中を含む）
 */
let arxivQueueLength = 0;

/**
 * 直近に arXiv へ送信を開始した時刻（epoch ms）
 */
let lastArxivSendAt = Number.NEGATIVE_INFINITY;

/**
 * テスト用: arXiv の待ち行列を初期状態に戻す
 */
export const resetArxivGateForTest = (): void => {
  arxivQueueTail = Promise.resolve();
  arxivQueueLength = 0;
  lastArxivSendAt = Number.NEGATIVE_INFINITY;
};

/**
 * arXiv へのリクエストを 1 本ずつ実行する。
 * 送信は「前回の送信開始 + 3 秒」と「前回の完了」の遅い方から始める。
 * 前にいる件数（実行中を含む）× 3 秒 + 現在の間隔の残り が上限を超える場合は、並ばずに ArxivRateLimitError を投げる。
 */
const runInArxivQueue = async <T>(task: () => Promise<T>): Promise<T> => {
  const intervalRemainingMs = Math.max(0, lastArxivSendAt + ARXIV_MIN_INTERVAL_MS - Date.now());
  const estimatedWaitMs = arxivQueueLength * ARXIV_MIN_INTERVAL_MS + intervalRemainingMs;
  if (estimatedWaitMs > ARXIV_MAX_WAIT_MS) {
    throw new ArxivRateLimitError(
      `arXiv request queue is full (estimated wait ${estimatedWaitMs}ms)`,
      // 受け付けられるまでのおおよその秒数（超過分 + 1 枠分）
      Math.ceil((estimatedWaitMs - ARXIV_MAX_WAIT_MS) / 1000) + ARXIV_MIN_INTERVAL_MS / 1000
    );
  }

  arxivQueueLength += 1;
  const previous = arxivQueueTail;
  let release = (): void => {};
  arxivQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 見積もりは 1 件 3 秒で数えるが、実際の占有は fetch の完了まで（最大 25 秒）。並んだ後も上限を超えたら待たずに抜ける
  const deadline = Date.now() + ARXIV_MAX_WAIT_MS;
  const queueTimeoutError = () =>
    new ArxivRateLimitError("arXiv request queue wait timed out", ARXIV_MIN_INTERVAL_MS / 1000);
  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const isReady = await Promise.race([
      previous.then(() => true),
      new Promise<false>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), ARXIV_MAX_WAIT_MS);
      }),
    ]);
    clearTimeout(timeoutId);
    if (!isReady) throw queueTimeoutError();
    const waitMs = lastArxivSendAt + ARXIV_MIN_INTERVAL_MS - Date.now();
    if (Date.now() + Math.max(0, waitMs) > deadline) throw queueTimeoutError();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastArxivSendAt = Date.now();
    return await task();
  } finally {
    arxivQueueLength -= 1;
    // 途中で抜けた場合も直列を崩さないよう、自分の枠は前のリクエストの完了後に解放する
    void previous.then(release);
  }
};

/**
 * タイムアウト（TimeoutError / AbortError）またはネットワーク失敗（fetch の TypeError）か
 */
const isNetworkFailure = (error: unknown): error is Error =>
  error instanceof TypeError ||
  (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));

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
 * 同期期間から開始日を計算する
 * @param period 同期期間（日数）
 * @returns 開始日のDateオブジェクト
 */
const getPeriodStartDate = (period: SyncPeriod): Date => {
  const days = Number.parseInt(period, 10);
  return subDays(new Date(), days);
};

/**
 * submittedDate 範囲クエリ用に日付を GMT で YYYYMMDDHHmm にフォーマットする
 * @param date 変換対象の日付
 * @returns arXiv API の submittedDate 用文字列（GMT）
 */
const formatForSubmittedDate = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}`;
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
 * fromDate（YYYY-MM-DD）をその日 00:00 UTC の Date に変換する
 */
const getStartDateFromFromDate = (fromDate: string): Date => parseISO(`${fromDate}T00:00:00.000Z`);

/**
 * toDate（YYYY-MM-DD）をその日 23:59:59.999 UTC の Date に変換する（終了日 inclusive）
 */
const getEndDateFromToDate = (toDate: string): Date => parseISO(`${toDate}T23:59:59.999Z`);

/**
 * クエリ用の開始日を取得する。toDate 指定時は toDate − period、fromDate 優先、なければ period から算出
 */
const getQueryStartDate = (
  period?: SyncPeriod,
  fromDate?: string,
  toDate?: string
): Date | undefined => {
  if (toDate) {
    const periodDays = Number.parseInt(period ?? "30", 10);
    return subDays(parseISO(`${toDate}T00:00:00.000Z`), periodDays);
  }
  if (fromDate) return getStartDateFromFromDate(fromDate);
  if (period) return getPeriodStartDate(period);
  return undefined;
};

/**
 * クエリ用の終了日を取得する。toDate 指定時はその日終了、指定がなければ今日
 */
const getQueryEndDate = (toDate?: string): Date =>
  toDate != null ? getEndDateFromToDate(toDate) : new Date();

/**
 * arXiv API用のクエリ文字列を構築する
 * period / fromDate / toDate に応じて submittedDate 範囲を AND で追加する
 */
const buildSearchQuery = (
  categories: string[],
  period?: SyncPeriod,
  fromDate?: string,
  toDate?: string
): string => {
  const categoryQuery = categories.map((cat) => `cat:${cat}`).join("+OR+");
  const startDate = getQueryStartDate(period, fromDate, toDate);
  if (!startDate) return categoryQuery;

  const endDate = getQueryEndDate(toDate);
  const fromStr = formatForSubmittedDate(
    new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 0, 0)
    )
  );
  const toStr = formatForSubmittedDate(endDate);
  const dateRangeQuery = `submittedDate:[${fromStr}+TO+${toStr}]`;
  // カテゴリ群を括弧で囲み AND の優先順位を保証する
  // 括弧なしだと arXiv が左から右に評価し、最後のカテゴリにしか日付フィルタが適用されない
  return `(${categoryQuery})+AND+${dateRangeQuery}`;
};

/**
 * arXiv APIから論文データを取得する
 */
export const fetchArxivPapers = async (options: ArxivQueryOptions): Promise<ArxivFetchResult> => {
  const { categories, maxResults, start = 0, period, fromDate, toDate } = options;

  const searchQuery = buildSearchQuery(categories, period, fromDate, toDate);
  const encodedQuery = encodeArxivQuery(searchQuery);
  const url = `${ARXIV_API_URL}?search_query=${encodedQuery}&start=${start}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

  let response: Response;
  let xml: string;
  try {
    // 本文の読み込みまでを 1 本の接続として扱い、完了してから次のリクエストを送る
    ({ response, xml } = await runInArxivQueue(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(ARXIV_FETCH_TIMEOUT_MS) });
      const text = res.ok ? await res.text() : await res.text().catch(() => "");
      return { response: res, xml: text };
    }));
  } catch (error) {
    if (isNetworkFailure(error)) {
      throw new ArxivServiceUnavailableError(`arXiv API request failed: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = xml;
    const errorMatch = errorText.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const errorMessage = errorMatch?.[1]?.trim() || errorText.substring(0, 1000);
    const message = `arXiv API error: ${response.status} ${response.statusText} - ${errorMessage}`;
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? parseInt(retryAfterRaw, 10) : undefined;
      throw new ArxivRateLimitError(
        message,
        retryAfterSec != null && Number.isFinite(retryAfterSec) ? retryAfterSec : undefined
      );
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new ArxivServiceUnavailableError(message);
    }
    throw new ArxivHttpError(message, response.status);
  }

  // totalResultsを抽出
  const totalMatch = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/i);
  const totalResults = totalMatch?.[1] ? Number.parseInt(totalMatch[1], 10) : 0;

  // エントリを抽出してパース
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let papers = Array.from(xml.matchAll(entryRegex), (m) => parseArxivEntry(m[1] ?? ""));

  const startDate = getQueryStartDate(period, fromDate, toDate);
  const endDate = getQueryEndDate(toDate);
  // fromDate/toDate 指定時はクエリが submittedDate で既に絞っているため、published/updated での追加フィルタは行わない
  // （submitted と published/updated は一致しないことが多く、フィルタで全件落ちることがある）
  const skipDateFilter = fromDate != null || toDate != null;
  if (startDate && !skipDateFilter) {
    papers = papers.filter((paper) => {
      const paperDate = paper.updatedAt > paper.publishedAt ? paper.updatedAt : paper.publishedAt;
      return paperDate >= startDate && paperDate <= endDate;
    });
  }
  return {
    papers,
    totalResults,
  };
};
