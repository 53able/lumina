import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { SearchHistory } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";
import {
  isSameRecords,
  notifyDbChange,
  reloadUnlessChanged,
  subscribeDbChanges,
} from "../lib/dbChangeChannel";

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
  /**
   * 検索履歴を削除する
   * DB削除の成功後に一覧から外し、元のレコードを deletedHistories に退避する。
   * 失敗しても例外は投げず historyErrors に残す（一覧の行も残す）。
   */
  deleteHistory: (id: string) => Promise<void>;
  /**
   * 削除した検索履歴を元のレコードのまま戻す
   * 同じクエリの履歴がある場合は上書きせず、退避を残したまま終える（競合は findRestoreConflict で判定する）。
   * 失敗しても退避内容は破棄せず historyErrors に残す。
   */
  restoreHistory: (id: string) => Promise<void>;
  /** 削除した検索履歴の退避を破棄する（復元を取りやめる） */
  discardDeletedHistory: (id: string) => void;
  /** 操作失敗の表示を閉じる */
  dismissHistoryError: (id: string) => void;
  /** 全検索履歴を削除する */
  clearAllHistories: () => Promise<void>;
  /** 検索履歴数を取得する */
  getHistoryCount: () => number;
}

type SearchHistoryStore = SearchHistoryState & SearchHistoryActions;

/** 操作失敗の表示用メッセージ */
const toErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "不明なエラー";

/** 指定キーを除いたレコードを返す */
const withoutKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

/**
 * 削除した履歴を戻すと衝突する履歴（同じクエリで別IDのもの）を返す
 * 削除後に同じクエリで再検索すると新しい履歴ができるため、Undo でそれを上書きしない判定に使う。
 */
export const findRestoreConflict = (
  histories: SearchHistory[],
  deleted: SearchHistory
): SearchHistory | undefined =>
  histories.find((h) => h.id !== deleted.id && h.originalQuery === deleted.originalQuery);

/**
 * 検索履歴を新しい順にソートする
 */
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

        // 同じクエリの既存履歴を新しい履歴で置き換える。
        // 復元（restoreHistory）と並行しても同じクエリが2件にならないよう、DB を基準に1トランザクションで判定・書き込みする
        await db.transaction("rw", db.searchHistories, async () => {
          await db.searchHistories.where("originalQuery").equals(history.originalQuery).delete();
          await db.searchHistories.add(history);
        });
        set((state) => ({
          histories: sortByCreatedAtDesc([
            ...state.histories.filter((h) => h.originalQuery !== history.originalQuery),
            history,
          ]),
        }));
        notifyDbChange(db, { table: "searchHistories" });
      },

      getHistoryById: (id) => {
        return get().histories.find((h) => h.id === id);
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
          notifyDbChange(db, { table: "searchHistories" });
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
        if (findRestoreConflict(get().histories, target)) return;

        set((state) => ({
          pendingHistoryIds: [...state.pendingHistoryIds, id],
          historyErrors: withoutKey(state.historyErrors, id),
        }));
        try {
          const db = get()._db;
          if (!db) throw new Error("DB not initialized");
          // 同じクエリの履歴の有無を DB 基準で確かめてから書く（addHistory と同じトランザクション境界）
          const dbConflict = await db.transaction("rw", db.searchHistories, async () => {
            const conflict = await db.searchHistories
              .where("originalQuery")
              .equals(target.originalQuery)
              .first();
            if (conflict) return conflict;
            await db.searchHistories.add(target);
            return null;
          });
          if (!dbConflict) notifyDbChange(db, { table: "searchHistories" });
          if (dbConflict) {
            // DB にだけ同じクエリの履歴がある（一覧が古い）場合も、一覧へ反映して競合として見せる
            set((state) =>
              state.histories.some((h) => h.id === dbConflict.id)
                ? {}
                : {
                    histories: sortByCreatedAtDesc([
                      ...state.histories.filter(
                        (h) => h.originalQuery !== dbConflict.originalQuery
                      ),
                      dbConflict,
                    ]),
                  }
            );
            return;
          }
          set((state) =>
            // 書き込み後に同じクエリの再検索が反映された場合、DB では新しい履歴が復元分を置き換えている
            findRestoreConflict(state.histories, target)
              ? {}
              : {
                  // 別タブの変更の読み直しで復元分を一覧へ反映済みの場合があるため、同じ履歴は除いてから足す
                  histories: sortByCreatedAtDesc([
                    ...state.histories.filter((h) => h.id !== id),
                    target,
                  ]),
                  deletedHistories: state.deletedHistories.filter((h) => h.id !== id),
                }
          );
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

      clearAllHistories: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.searchHistories.clear();

        // Storeを更新（全件削除は元に戻せないため、個別削除の退避と失敗表示も破棄する）
        set({ histories: [], deletedHistories: [], historyErrors: {} });
        notifyDbChange(db, { table: "searchHistories" });
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
  unsubscribeRemoteChanges?.();
  unsubscribeRemoteChanges = subscribeDbChanges(db, "searchHistories", () => {
    return reloadHistories(db).catch((error: unknown) => {
      console.warn("Failed to reload search histories changed in another tab", error);
    });
  });

  // IndexedDBから全検索履歴をロード（新しい順）
  // 読み込み中に別タブの変更を反映した場合は読み直す（読み込み開始時点の古い全件で反映を消さない）
  await reloadUnlessChanged(
    () => useSearchHistoryStore.getState().histories,
    () => readHistories(db),
    (histories) => useSearchHistoryStore.setState({ histories, isLoading: false })
  );
};

/** 別タブの変更の購読の解除関数（再初期化で二重に購読しないため） */
let unsubscribeRemoteChanges: (() => void) | null = null;

// 開発時の HMR でモジュールが置き換わるとき、古いストアへの購読を解除する
import.meta.hot?.dispose(() => unsubscribeRemoteChanges?.());

/** IndexedDB から全検索履歴を新しい順に読む */
const readHistories = (db: LuminaDB): Promise<SearchHistory[]> =>
  db.searchHistories.orderBy("createdAt").reverse().toArray();

/**
 * 別タブで変更された検索履歴を IndexedDB から読み直す
 * 削除の退避（Undo）はこのタブのものなので残す。ただし DB に戻っている履歴は退避から外す
 * （一覧にある履歴に「元に戻す」を残さないため）
 */
const reloadHistories = (db: LuminaDB): Promise<void> =>
  reloadUnlessChanged(
    () => useSearchHistoryStore.getState().histories,
    () => readHistories(db),
    (histories) => {
      // 内容が同じなら反映しない（復帰のたびに参照を差し替えて再描画させない）
      if (isSameRecords(useSearchHistoryStore.getState().histories, histories)) return;
      const ids = new Set(histories.map((h) => h.id));
      useSearchHistoryStore.setState((state) => ({
        histories,
        deletedHistories: state.deletedHistories.filter((h) => !ids.has(h.id)),
      }));
    }
  );
