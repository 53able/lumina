import type { InitialData } from "../dataLoader";

/**
 * 初期データを埋め込むスクリプトを生成
 *
 * クライアント側で`window.__INITIAL_DATA__`としてアクセスできるようにする。
 *
 * @param initialData - 埋め込む初期データ
 * @returns 初期データスクリプトのHTML文字列、または空文字列（initialDataが未指定の場合）
 */
export const generateInitialDataScript = (initialData?: InitialData): string => {
  if (!initialData) {
    return "";
  }

  return `<script>window.__INITIAL_DATA__ = ${JSON.stringify(initialData)};</script>`;
};
