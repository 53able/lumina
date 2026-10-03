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
 * @param threshold - しきい値で0件になったかを判定する情報（省略時は判定しない）
 * @param threshold.scoreThreshold - 現在の類似度しきい値
 * @param threshold.hasSearchablePapers - Embeddingのある論文が1件以上あるか
 * @returns 表示する ReactNode、または undefined（メッセージ不要な場合）
 */
export const getEmptySearchMessage = (
  isSearchActive: boolean,
  resultCount: number,
  searchError: Error | null,
  queryEmbedding: number[] | null,
  isLoading: boolean,
  threshold?: { scoreThreshold: number; hasSearchablePapers: boolean }
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

  // 検索対象の論文はあるが、どれも類似度がしきい値に届かない（しきい値を下げれば結果が出る）
  if (threshold?.hasSearchablePapers) {
    return (
      <>
        <p className="text-lg text-muted-foreground">
          類似度がしきい値 {threshold.scoreThreshold.toFixed(2)} 以上の論文はありません
        </p>
        {/* しきい値が下限（0）ならこれ以上は下げられないため、下げる案内は出さない */}
        {threshold.scoreThreshold > 0 ? (
          <p className="text-sm text-muted-foreground/70">
            しきい値を下げると、類似度の低い論文も表示されます。
          </p>
        ) : null}
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
