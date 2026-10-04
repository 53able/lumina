import { ApiDisabledError, SearchApiError } from "./api";

/**
 * 索引での類似度の計算に失敗したときのエラー（Worker 内の計算の失敗など。論文の読み込み失敗は PaperLoadError）
 */
export class SearchComputeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SearchComputeError";
  }
}

/**
 * 検索の失敗の分類
 * - api_disabled: 設定で API 利用が OFF（設定を直す）
 * - auth: APIキーが無効・権限なし（設定を直す）
 * - decrypt: 保存した APIキーを復号できない（設定で再入力する）
 * - paper_load: 保存済み論文の読み込みに失敗（読み込み直してから手動で再試行する）
 * - compute: 索引での計算に失敗（手動で再試行する。続くなら画面を再読み込みする）
 * - rate_limit: 利用上限（時間をおいて手動で再試行する）
 * - server: サーバーエラー（5xx。サーバーは上流の認証・上限の失敗も 500 で返すため、設定の確認も案内する）
 * - other: 通信失敗など（手動で再試行する）
 */
export type SearchFailureKind =
  | "api_disabled"
  | "auth"
  | "decrypt"
  | "paper_load"
  | "compute"
  | "rate_limit"
  | "server"
  | "other";

/** 分類ごとの案内文（api_disabled は再開方法を含む ApiDisabledError の文を使う） */
export const SEARCH_FAILURE_MESSAGES: Record<Exclude<SearchFailureKind, "api_disabled">, string> = {
  auth: "APIキーが無効か、権限がありません。設定でAPIキーを確認してください。",
  decrypt: "保存したAPIキーを復号できませんでした。設定でAPIキーを再入力してください。",
  paper_load:
    "保存済みの論文を読み込めないため検索できません。一覧の上の「再試行」で読み込み直してから、もう一度検索してください。",
  compute:
    "検索結果の計算に失敗しました。再試行してください。続く場合は画面を再読み込みしてください。",
  rate_limit: "検索の利用上限に達しました。時間をおいて再試行してください。",
  server: "検索に失敗しました。時間をおいて再試行するか、設定でAPIキーを確認してください。",
  other: "検索に失敗しました。通信状況を確認して再試行してください。",
};

/**
 * 確定した結果の再計算（論文の更新・しきい値の変更）に失敗したときの案内。
 * 新しい検索の失敗と区別し、表示中の結果が更新前のものであることを伝える
 */
export const RECOMPUTE_FAILURE_TITLE = "表示中の結果を最新の論文・しきい値で更新できませんでした";

/** 再計算の失敗の分類ごとの案内文（読み込みの失敗とそれ以外） */
export const RECOMPUTE_FAILURE_MESSAGES = {
  paper_load:
    "保存済みの論文を読み込めないため、表示中は更新前の結果です。一覧の上の「再試行」で読み込み直してから、再試行してください。",
  compute: "表示中は更新前の結果です。再試行してください。続く場合は画面を再読み込みしてください。",
} as const;

/** 検索欄の近くに出す失敗の案内 */
export interface SearchFailure {
  kind: SearchFailureKind;
  /** 利用者向けの理由と対処（上流のエラー文は含めない。API利用OFFは再開方法を含む自前の文） */
  message: string;
  /** 同じ条件での再試行を案内するか（設定を直さない限り失敗する分類では案内しない） */
  canRetry: boolean;
  /** 「設定を開く」を案内するか（設定を直すと解決する・解決しうる分類） */
  suggestSettings: boolean;
  /**
   * 前回の結果がないとき、理由と対処を一覧の0件表示（emptySearchMessage）に出す分類か。
   * 検索欄の近くでは同じ説明を繰り返さない
   */
  explainedInList: boolean;
}

/** 分類から案内を組み立てる */
const failure = (
  kind: Exclude<SearchFailureKind, "api_disabled">,
  options: { canRetry: boolean; suggestSettings: boolean; explainedInList?: boolean }
): SearchFailure => ({
  kind,
  message: SEARCH_FAILURE_MESSAGES[kind],
  explainedInList: false,
  ...options,
});

/**
 * 検索の失敗を分類し、検索欄の近くに出す案内を返す。
 * 自動再試行はしない。canRetry は利用者が明示的に再試行する操作を出すかどうかだけを表す。
 */
export const describeSearchFailure = (error: Error): SearchFailure => {
  if (error instanceof ApiDisabledError) {
    return {
      kind: "api_disabled",
      message: error.message,
      canRetry: false,
      suggestSettings: true,
      explainedInList: false,
    };
  }
  if (error.name === "OperationError") {
    return failure("decrypt", { canRetry: false, suggestSettings: true, explainedInList: true });
  }
  if (error.name === "PaperLoadError") {
    return failure("paper_load", { canRetry: true, suggestSettings: false, explainedInList: true });
  }
  if (error.name === "SearchComputeError") {
    return failure("compute", { canRetry: true, suggestSettings: false });
  }
  if (error instanceof SearchApiError) {
    if (error.status === 401 || error.status === 403) {
      return failure("auth", { canRetry: false, suggestSettings: true });
    }
    if (error.status === 429) {
      return failure("rate_limit", { canRetry: true, suggestSettings: false });
    }
    if (error.status >= 500) {
      // サーバーは上流の認証失敗も 500 で返すため、再試行と設定の確認の両方を出す
      return failure("server", { canRetry: true, suggestSettings: true });
    }
  }
  return failure("other", { canRetry: true, suggestSettings: false });
};
