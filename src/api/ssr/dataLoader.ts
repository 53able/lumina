import type { Context } from "hono";
import type { Paper, PaperSummary } from "../../shared/schemas/index";
import type { AppType } from "../app";

/**
 * 初期データの型定義
 */
export interface InitialData {
  papers?: Paper[];
  paper?: Paper;
  summary?: PaperSummary;
}

/**
 * デフォルトの対象カテゴリ（settingsStoreと同じ）
 */
const DEFAULT_CATEGORIES = ["cs.AI", "cs.LG", "cs.CL", "stat.ML"];

/**
 * デフォルトの同期期間（7日）
 */
const DEFAULT_SYNC_PERIOD_DAYS = 7;

/**
 * Basic認証のデフォルト認証情報（内部リクエスト用）
 */
const getInternalAuthHeader = (): string => {
  const username = process.env.BASIC_AUTH_USERNAME ?? "admin";
  const password = process.env.BASIC_AUTH_PASSWORD ?? "admin";
  const credentials = `${username}:${password}`;
  // Edge Runtime / Browser 互換の btoa を使用
  return `Basic ${btoa(credentials)}`;
};

/**
 * 内部APIリクエストのURLを生成
 *
 * @param c - Honoコンテキスト
 * @param path - APIパス
 * @returns 内部APIリクエスト用のURL
 */
const createInternalApiUrl = (c: Context, path: string): string => {
  // リクエストのオリジンを使用（環境に依存しない）
  const url = new URL(c.req.url);
  return `${url.origin}${path}`;
};

/**
 * ホームページ（/）の初期データを取得
 *
 * @param app - Honoアプリのインスタンス
 * @param c - Honoコンテキスト
 * @returns 初期データ
 */
export const loadHomePageData = async (app: AppType, c: Context): Promise<InitialData> => {
  try {
    // 内部でAPIを呼び出して論文を取得
    // デフォルト設定で同期を実行
    const request = new Request(createInternalApiUrl(c, "/api/v1/sync"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getInternalAuthHeader(),
      },
      body: JSON.stringify({
        categories: DEFAULT_CATEGORIES,
        period: String(DEFAULT_SYNC_PERIOD_DAYS),
        maxResults: 50,
        start: 0,
      }),
    });

    // Honoアプリの内部でリクエストを処理
    const response = await app.fetch(request, c.env);

    if (!response.ok) {
      console.warn("[SSR] Failed to fetch papers, returning empty data");
      return { papers: [] };
    }

    const data = (await response.json()) as { papers: Paper[] };
    return { papers: data.papers ?? [] };
  } catch (error) {
    console.error("[SSR] Error loading home page data:", error);
    return { papers: [] };
  }
};

/**
 * 論文詳細ページ（/papers/:id）の初期データを取得
 *
 * @param app - Honoアプリのインスタンス
 * @param c - Honoコンテキスト
 * @param paperId - 論文ID
 * @returns 初期データ
 */
export const loadPaperPageData = async (
  app: AppType,
  c: Context,
  paperId: string
): Promise<InitialData> => {
  try {
    // まず論文一覧を取得して、指定されたIDの論文を探す
    const homeData = await loadHomePageData(app, c);
    const paper = homeData.papers?.find((p) => p.id === paperId);

    if (!paper) {
      return {};
    }

    // サマリーはクライアント側で生成されるため、サーバー側では取得しない
    // （要約生成APIは認証が必要で、サーバー側ではAPIキーにアクセスできない）
    return {
      paper,
    };
  } catch (error) {
    console.error("[SSR] Error loading paper page data:", error);
    return {};
  }
};

/**
 * ルートに応じた初期データを取得
 *
 * @param app - Honoアプリのインスタンス
 * @param c - Honoコンテキスト
 * @param pathname - リクエストパス
 * @returns 初期データ
 */
export const loadInitialData = async (
  app: AppType,
  c: Context,
  pathname: string
): Promise<InitialData> => {
  // 論文詳細ページのパターン: /papers/:id
  const paperPageMatch = pathname.match(/^\/papers\/(.+)$/);
  const paperId = paperPageMatch?.[1];
  if (paperId) {
    return loadPaperPageData(app, c, paperId);
  }

  // ホームページ
  return loadHomePageData(app, c);
};
