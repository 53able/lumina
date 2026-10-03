import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SearchHistory } from "../../shared/schemas/index";
import {
  findRestoreConflict,
  type SearchHistoryOperationError,
  useSearchHistoryStore,
} from "../stores/searchHistoryStore";

/**
 * 検索履歴の個別削除と取り消し（Undo）の状態・操作
 * 削除の実行と結果（退避・失敗・処理中）を同じ出どころから渡す。
 */
export interface SearchHistoryUndo {
  /** このセッションで削除した履歴（削除の新しい順） */
  deletedHistories: SearchHistory[];
  /** 履歴IDごとの削除・復元の失敗 */
  historyErrors: Record<string, SearchHistoryOperationError>;
  /** 削除中・復元中の履歴ID */
  pendingHistoryIds: string[];
  /** 同じクエリの新しい履歴があり、元に戻すと衝突する削除済み履歴のID */
  restoreConflictIds: string[];
  /** 履歴を削除する（失敗は historyErrors に残る。再試行も同じ操作） */
  deleteHistory: (id: string) => Promise<void>;
  /** 削除した履歴を元に戻す（失敗は historyErrors に残る。再試行も同じ操作） */
  restoreHistory: (id: string) => Promise<void>;
  /** 元に戻すのをやめ、退避を破棄する */
  discardDeletedHistory: (id: string) => void;
  /** 削除失敗の表示を閉じる */
  dismissHistoryError: (id: string) => void;
}

const EMPTY_HISTORIES: SearchHistory[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_ERRORS: Record<string, SearchHistoryOperationError> = {};

/**
 * useSearchHistoryUndo - 検索履歴の削除・取り消しを searchHistoryStore から取り出す
 *
 * 欠けた値は空として扱う（ストアを部分的に差し替えた呼び出し元でも描画を壊さない）。
 */
export const useSearchHistoryUndo = (): SearchHistoryUndo => {
  const {
    histories = EMPTY_HISTORIES,
    deletedHistories = EMPTY_HISTORIES,
    historyErrors = EMPTY_ERRORS,
    pendingHistoryIds = EMPTY_IDS,
    deleteHistory,
    restoreHistory,
    discardDeletedHistory,
    dismissHistoryError,
  } = useSearchHistoryStore(
    useShallow((state) => ({
      histories: state.histories,
      deletedHistories: state.deletedHistories,
      historyErrors: state.historyErrors,
      pendingHistoryIds: state.pendingHistoryIds,
      deleteHistory: state.deleteHistory,
      restoreHistory: state.restoreHistory,
      discardDeletedHistory: state.discardDeletedHistory,
      dismissHistoryError: state.dismissHistoryError,
    }))
  );

  const restoreConflictIds = useMemo(
    () =>
      deletedHistories
        .filter((deleted) => findRestoreConflict(histories, deleted))
        .map((deleted) => deleted.id),
    [histories, deletedHistories]
  );

  // HomeMain は memo のため、値が変わらない限り同じオブジェクトを返す
  return useMemo(
    () => ({
      deletedHistories,
      historyErrors,
      pendingHistoryIds,
      restoreConflictIds,
      deleteHistory,
      restoreHistory,
      discardDeletedHistory,
      dismissHistoryError,
    }),
    [
      deletedHistories,
      historyErrors,
      pendingHistoryIds,
      restoreConflictIds,
      deleteHistory,
      restoreHistory,
      discardDeletedHistory,
      dismissHistoryError,
    ]
  );
};
