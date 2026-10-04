import { ApiDisabledError, SearchApiError } from "./api";

/**
 * 検索の失敗の分類
 * - api_disabled: 設定で API 利用が OFF（設定を直す）
 * - auth: APIキーが無効・権限なし（設定を直す）
 * - decrypt: 保存した APIキーを復号できない（設定で再入力する）
 * - paper_load: 保存済み論文の読み込みに失敗（読み込み直してから手動で再試行する）
 * - rate_limit: 利用上限（時間をおいて手動で再試行する）
 * - server: サーバーエラー（5xx。サーバーは上流の認証・上限の失敗も 500 で返すため、設定の確認も案内する）
 * - other: 通信失敗など（手動で再試行する）
 */
export type SearchFailureKind =
  | "api_disabled"
  | "auth"
  | "decrypt"
  | "paper_load"
  | "rate_limit"
  | "server"
  | "other";

/** 検索欄の近くに出す失敗の案内 */
export interface SearchFailure {
  kind: SearchFailureKind;
  /** 利用者向けの理由と対処（上流のエラー文は含めない。API利用OFFは再開方法を含む自前の文） */
  message: string;
  /** 同じ条件での再試行を案内するか（設定を直さない限り失敗する分類では案内しない） */
  canRetry: boolean;
  /** 「設定を開く」を案内するか（設定を直すと解決する・解決しうる分類） */
  suggestSettings: boolean;
}

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
    };
  }
  if (error.name === "OperationError") {
    return {
      kind: "decrypt",
      message: "保存したAPIキーを復号できませんでした。設定でAPIキーを再入力してください。",
      canRetry: false,
      suggestSettings: true,
    };
  }
  if (error.name === "PaperLoadError") {
    return {
      kind: "paper_load",
      message:
        "保存済みの論文を読み込めないため検索できません。一覧の上の「再試行」で読み込み直してから、もう一度検索してください。",
      canRetry: true,
      suggestSettings: false,
    };
  }
  if (error instanceof SearchApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        kind: "auth",
        message: "APIキーが無効か、権限がありません。設定でAPIキーを確認してください。",
        canRetry: false,
        suggestSettings: true,
      };
    }
    if (error.status === 429) {
      return {
        kind: "rate_limit",
        message: "検索の利用上限に達しました。時間をおいて再試行してください。",
        canRetry: true,
        suggestSettings: false,
      };
    }
    if (error.status >= 500) {
      return {
        kind: "server",
        message: "検索に失敗しました。時間をおいて再試行するか、設定でAPIキーを確認してください。",
        canRetry: true,
        // サーバーは上流の認証失敗も 500 で返すため、再試行と設定の確認の両方を出す
        suggestSettings: true,
      };
    }
  }
  return {
    kind: "other",
    message: "検索に失敗しました。通信状況を確認して再試行してください。",
    canRetry: true,
    suggestSettings: false,
  };
};
