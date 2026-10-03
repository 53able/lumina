import type { ReactNode } from "react";

/**
 * 検索0件時に表示するメッセージの種別
 */
export type EmptySearchMessageKind =
  | "api-key-decrypt-failed"
  | "api-key-required"
  | "no-results"
  | null;

/**
 * 検索が有効で結果が0件のとき、理由に応じたメッセージを返す。
 * 純粋関数のため単体テスト・スナップショットが容易。
 *
 * @param isSearchActive - 検索が実行済みか（expandedQuery !== null）
 * @param resultCount - 検索結果件数
 * @param searchError - 検索時のエラー（OperationError は API キー復号失敗）
 * @param queryEmbedding - 現在のクエリ Embedding（null は API キー未設定の可能性）
 * @param isLoading - 検索処理中かどうか
 * @param resultsReady - 結果が全件に対して確定したか（確定前は「該当なし」を出さない）
 * @returns 表示する ReactNode、または undefined（メッセージ不要な場合）
 */
export const getEmptySearchMessage = (
  isSearchActive: boolean,
  resultCount: number,
  searchError: Error | null,
  queryEmbedding: number[] | null,
  isLoading: boolean,
  resultsReady = true
): ReactNode => {
  // ローディング中はメッセージを表示しない
  if (isLoading) return undefined;
  if (!isSearchActive || resultCount > 0) return undefined;

  if (searchError?.name === "OperationError") {
    return (
      <>
        <p className="text-lg text-muted-foreground">APIキーの復号に失敗しました</p>
        <p className="text-sm text-muted-foreground/70">
          別のブラウザやアドレス（http/https
          など）で保存した可能性があります。設定でAPIキーを再入力してください。
        </p>
      </>
    );
  }

  if (searchError?.name === "PaperLoadError") {
    return (
      <>
        <p className="text-lg text-muted-foreground">
          保存済みの論文を読み込めないため検索できません
        </p>
        <p className="text-sm text-muted-foreground/70">
          一覧の上の「再試行」で読み込み直してから、もう一度検索してください。
        </p>
        <p className="break-all text-xs text-muted-foreground/70">詳細: {searchError.message}</p>
      </>
    );
  }

  // 結果が確定する前（保存済み論文の読み込み中など）は「該当なし」を出さない
  if (!resultsReady) return undefined;

  if (queryEmbedding === null) {
    return (
      <>
        <p className="text-lg text-muted-foreground">検索にはAPIキーが必要です</p>
        <p className="text-sm text-muted-foreground/70">
          設定でOpenAI APIキーを入力してください。別デバイスでは設定が同期されません。
        </p>
      </>
    );
  }

  return (
    <>
      <p className="text-lg text-muted-foreground">該当する論文がありませんでした</p>
      <p className="text-sm text-muted-foreground/70">
        このデバイスに論文データが同期されていないか、Embeddingが未設定の可能性があります。同期ボタンや「Embeddingを補完」を試してください。
      </p>
    </>
  );
};
