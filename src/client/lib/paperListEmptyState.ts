/**
 * 論文一覧が0件のときに、なぜ0件なのかを区別して説明と次の操作を決める。
 *
 * - 未同期: このデバイスに論文がまだない → 同期する／設定を開く
 * - 同期失敗: 論文がなく、直近の同期が失敗した → 同期を再試行
 * - 該当なし: 論文はあるが、検索・絞り込みに一致しない → 条件を解除
 */

/** 0件表示の種別 */
export type PaperListEmptyStateKind = "loading" | "not-synced" | "sync-failed" | "no-results";

/** 0件表示で提示する操作 */
export type PaperListEmptyAction = "sync" | "retry-sync" | "open-settings" | "clear-conditions";

/** 0件表示の内容 */
export interface PaperListEmptyState {
  kind: PaperListEmptyStateKind;
  /** 何が起きているか */
  title: string;
  /** 次に何をすればよいか */
  description: string;
  /** 同期失敗時の理由（エラーメッセージ） */
  detail?: string;
  /** 提示する操作（先頭が主操作） */
  actions: PaperListEmptyAction[];
}

/** 判定に使う入力 */
export interface PaperListEmptyStateInput {
  /** このデバイスに保存済みの論文数（検索・絞り込み前） */
  storedPaperCount: number;
  /** 同期中、または保存済み論文の読み込み中か */
  isLoading: boolean;
  /** 直近の同期エラー（成功すると null に戻る） */
  lastSyncError: Error | null;
}

/**
 * 論文一覧が0件のときの表示内容を返す
 *
 * 保存済みの論文があれば、0件の原因は検索・絞り込みにある。
 * 保存済みの論文がなければ、直近の同期が失敗したかどうかで未同期と同期失敗を分ける。
 */
export const getPaperListEmptyState = ({
  storedPaperCount,
  isLoading,
  lastSyncError,
}: PaperListEmptyStateInput): PaperListEmptyState => {
  if (isLoading) {
    return {
      kind: "loading",
      title: "論文を取得しています...",
      description: "",
      actions: [],
    };
  }

  if (storedPaperCount > 0) {
    return {
      kind: "no-results",
      title: "条件に一致する論文がありません",
      description: "検索語や絞り込みを変えるか、解除してすべての論文を表示してください。",
      actions: ["clear-conditions"],
    };
  }

  if (lastSyncError) {
    return {
      kind: "sync-failed",
      title: "論文を同期できませんでした",
      description: "接続を確認してから、同期を再試行してください。",
      detail: lastSyncError.message,
      actions: ["retry-sync"],
    };
  }

  return {
    kind: "not-synced",
    title: "このデバイスにはまだ論文がありません",
    description:
      "「同期」でarXivから論文を取得してください。検索や要約などのAI機能の利用は、設定から確認できます。",
    actions: ["sync", "open-settings"],
  };
};
