import type { InitialData } from "../dataLoader.js";

/**
 * 初期データスクリプト生成のオプション
 */
export interface InitialDataScriptOptions {
  /**
   * 埋め込む初期データ
   */
  initialData?: InitialData;
  /**
   * CSP nonce（本番環境で必須）
   */
  nonce?: string;
}

/**
 * 初期データを埋め込むスクリプトを生成
 *
 * クライアント側で`window.__INITIAL_DATA__`としてアクセスできるようにする。
 * 本番環境ではCSP nonceを使用してインラインスクリプトを許可する。
 *
 * @param options - 初期データスクリプト生成のオプション
 * @returns 初期データスクリプトのHTML文字列、または空文字列（initialDataが未指定の場合）
 */
export const generateInitialDataScript = (options: InitialDataScriptOptions): string => {
  const { initialData, nonce } = options;

  if (!initialData) {
    return "";
  }

  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script${nonceAttr}>window.__INITIAL_DATA__ = ${JSON.stringify(initialData)};</script>`;
};
