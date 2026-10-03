import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { SearchHistory } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";

/**
 * 検索履歴の個別操作（削除・復元）の失敗
 * 再試行が成功するか、利用者が閉じるまで残す
 */
export interface SearchHistoryOperationError {
  kind: "delete" | "restore";
  message: string;
}

/**
 * searchHistoryStore の状態型
 */
interface SearchHistoryState {
  /** 検索履歴の配列（新しい順） */
  histories: SearchHistory[];
  /**
   * このセッションで削除した検索履歴（削除の新しい順）
   * 元のレコードをそのまま保持し、Undo で同じ ID・日時・拡張クエリ・Embedding のまま戻す。
   * メモリ上だけに持つため、再読み込みすると戻せなくなる。
   */
  deletedHistories: SearchHistory[];
  /** 削除中・復元中の履歴ID（同じ対象の二重操作を防ぐ） */
  pendingHistoryIds: string[];
  /** 履歴IDごとの操作失敗 */
  historyErrors: Record<string, SearchHistoryOperationError>;
  /** ローディング状態 */
  isLoading: boolean;
  /** DBインスタンス（内部用） */
  _db: LuminaDB | null;
}

/**
 * searchHistoryStore のアクション型
 */
interface SearchHistoryActions {
  /** 検索履歴を追加する */
  addHistory: (history: SearchHistory) => Promise<void>;
  /** IDで検索履歴を取得する */
  getHistoryById: (id: string) => SearchHistory | undefined;
  /** 最新N件の検索履歴を取得する */
  getRecentHistories: (limit: number) => SearchHistory[];
  /**
   * 検索履歴を削除する
   * DB削除の成功後に一覧から外し、元のレコードを deletedHistories に退避する。
   * 失敗しても例外は投げず historyErrors に残す（一覧の行も残す）。
   */
  deleteHistory: (id: string) => Promise<void>;
  /**
   * 削除した検索履歴を元のレコードのまま戻す
   * 同じクエリの新しい履歴がある場合は上書きせず、何もしない（競合は hasRestoreConflict で判定する）。
   * 失敗しても退避内容は破棄せず historyErrors に残す。
   */
  restoreHistory: (id: string) => Promise<void>;
  /** 削除した検索履歴の退避を破棄する（復元を取りやめる） */
  discardDeletedHistory: (id: string) => void;
  /** 操作失敗の表示を閉じる */
  dismissHistoryError: (id: string) => void;
  /** 削除した履歴と同じクエリの履歴が現在あるか（Undo すると新しい履歴と衝突する） */
  hasRestoreConflict: (id: string) => boolean;
  /** 全検索履歴を削除する */
  clearAllHistories: () => Promise<void>;
  /** 検索履歴数を取得する */
  getHistoryCount: () => number;
}

type SearchHistoryStore = SearchHistoryState & SearchHistoryActions;

/**
 * 検索履歴を新しい順にソートする
 */
/** 操作失敗の表示用メッセージ */
const toErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "不明なエラー";

const withoutKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

const sortByCreatedAtDesc = (histories: SearchHistory[]): SearchHistory[] => {
  return [...histories].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};

/**
 * searchHistoryStore - 検索履歴の管理
 *
 * Zustand + IndexedDB永続化
 */
export const useSearchHistoryStore = create<SearchHistoryStore>()(
  devtools(
    (set, get) => ({
      // State
      histories: [],
      deletedHistories: [],
      pendingHistoryIds: [],
      historyErrors: {},
      isLoading: false,
      _db: null,

      // Actions
      addHistory: async (history) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // 同じクエリの既存履歴を検索
        const existingHistory = get().histories.find(
          (h) => h.originalQuery === history.originalQuery
        );

        if (existingHistory) {
          // 既存履歴をIndexedDBから削除
          await db.searchHistories.delete(existingHistory.id);
          // 新しい履歴をIndexedDBに保存
          await db.searchHistories.add(history);
          // Storeを更新（既存を削除して新しい履歴を追加）
          set((state) => ({
            histories: sortByCreatedAtDesc([
              ...state.histories.filter((h) => h.id !== existingHistory.id),
              history,
            ]),
          }));
        } else {
          // IndexedDBに保存
          await db.searchHistories.add(history);
          // Storeを更新（新しい順にソート）
          set((state) => ({
            histories: sortByCreatedAtDesc([...state.histories, history]),
          }));
        }
      },

      getHistoryById: (id) => {
        return get().histories.find((h) => h.id === id);
      },

      getRecentHistories: (limit) => {
        return get().histories.slice(0, limit);
      },

      deleteHistory: async (id) => {
        const target = get().histories.find((h) => h.id === id);
        if (!target || get().pendingHistoryIds.includes(id)) return;

        set((state) => ({
          pendingHistoryIds: [...state.pendingHistoryIds, id],
          historyErrors: withoutKey(state.historyErrors, id),
        }));
        try {
          const db = get()._db;
          if (!db) throw new Error("DB not initialized");
          await db.searchHistories.delete(id);
          set((state) => ({
            histories: state.histories.filter((h) => h.id !== id),
            deletedHistories: [target, ...state.deletedHistories.filter((h) => h.id !== id)],
          }));
        } catch (error) {
          set((state) => ({
            historyErrors: {
              ...state.historyErrors,
              [id]: { kind: "delete", message: toErrorMessage(error) },
            },
          }));
        } finally {
          set((state) => ({
            pendingHistoryIds: state.pendingHistoryIds.filter((pendingId) => pendingId !== id),
          }));
        }
      },

      restoreHistory: async (id) => {
        const target = get().deletedHistories.find((h) => h.id === id);
        if (!target || get().pendingHistoryIds.includes(id)) return;
        if (get().hasRestoreConflict(id)) return;

        set((state) => ({
          pendingHistoryIds: [...state.pendingHistoryIds, id],
          historyErrors: withoutKey(state.historyErrors, id),
        }));
        try {
          const db = get()._db;
          if (!db) throw new Error("DB not initialized");
          await db.searchHistories.add(target);
          // 書き込み中に同じクエリで新しい履歴ができた場合は、新しい履歴を残して復元を戻す
          if (get().hasRestoreConflict(id)) {
            await db.searchHistories.delete(id);
            return;
          }
          set((state) => ({
            histories: sortByCreatedAtDesc([...state.histories, target]),
            deletedHistories: state.deletedHistories.filter((h) => h.id !== id),
          }));
        } catch (error) {
          set((state) => ({
            historyErrors: {
              ...state.historyErrors,
              [id]: { kind: "restore", message: toErrorMessage(error) },
            },
          }));
        } finally {
          set((state) => ({
            pendingHistoryIds: state.pendingHistoryIds.filter((pendingId) => pendingId !== id),
          }));
        }
      },

      discardDeletedHistory: (id) => {
        set((state) => ({
          deletedHistories: state.deletedHistories.filter((h) => h.id !== id),
          historyErrors: withoutKey(state.historyErrors, id),
        }));
      },

      dismissHistoryError: (id) => {
        set((state) => ({ historyErrors: withoutKey(state.historyErrors, id) }));
      },

      hasRestoreConflict: (id) => {
        const target = get().deletedHistories.find((h) => h.id === id);
        if (!target) return false;
        return get().histories.some((h) => h.id !== id && h.originalQuery === target.originalQuery);
      },

      clearAllHistories: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.searchHistories.clear();

        // Storeを更新
        set({ histories: [] });
      },

      getHistoryCount: () => {
        return get().histories.length;
      },
    }),
    { name: "search-history-store" }
  )
);

/**
 * searchHistoryStoreを初期化する
 * IndexedDBからデータをロードしてStoreに設定
 *
 * @param db LuminaDBインスタンス
 */
export const initializeSearchHistoryStore = async (db: LuminaDB): Promise<void> => {
  // 削除の退避はセッション内だけで有効（再読み込みで破棄される）
  useSearchHistoryStore.setState({
    isLoading: true,
    _db: db,
    deletedHistories: [],
    pendingHistoryIds: [],
    historyErrors: {},
  });

  // IndexedDBから全検索履歴をロード（新しい順）
  const histories = await db.searchHistories.orderBy("createdAt").reverse().toArray();

  useSearchHistoryStore.setState({
    histories,
    isLoading: false,
  });
};
