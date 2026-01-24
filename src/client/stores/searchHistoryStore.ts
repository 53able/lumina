import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { LuminaDB } from "../db/db";
import type { SearchHistory } from "../../shared/schemas";

/**
 * searchHistoryStore の状態型
 */
interface SearchHistoryState {
  /** 検索履歴の配列（新しい順） */
  histories: SearchHistory[];
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
  /** 検索履歴を削除する */
  deleteHistory: (id: string) => Promise<void>;
  /** 全検索履歴を削除する */
  clearAllHistories: () => Promise<void>;
  /** 検索履歴数を取得する */
  getHistoryCount: () => number;
}

type SearchHistoryStore = SearchHistoryState & SearchHistoryActions;

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
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBから削除
        await db.searchHistories.delete(id);

        // Storeを更新
        set((state) => ({
          histories: state.histories.filter((h) => h.id !== id),
        }));
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
  useSearchHistoryStore.setState({ isLoading: true, _db: db });

  // IndexedDBから全検索履歴をロード（新しい順）
  const histories = await db.searchHistories.orderBy("createdAt").reverse().toArray();

  useSearchHistoryStore.setState({
    histories,
    isLoading: false,
  });
};
