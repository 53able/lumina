import { compareDesc } from "date-fns";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Paper } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";

/**
 * paperStore の状態型
 */
interface PaperState {
  /** 論文データの配列 */
  papers: Paper[];
  /** ローディング状態 */
  isLoading: boolean;
  /** DBインスタンス（内部用） */
  _db: LuminaDB | null;
}

/**
 * paperStore のアクション型
 */
interface PaperActions {
  /** 論文を追加する（既存の場合は更新） */
  addPaper: (paper: Paper) => Promise<void>;
  /** 複数の論文を一括追加する */
  addPapers: (papers: Paper[]) => Promise<void>;
  /** IDで論文を取得する */
  getPaperById: (id: string) => Paper | undefined;
  /** 論文を削除する */
  deletePaper: (id: string) => Promise<void>;
  /** 全論文を削除する */
  clearAllPapers: () => Promise<void>;
  /** カテゴリで論文をフィルタリングする */
  getPapersByCategory: (category: string) => Paper[];
  /** 論文数を取得する */
  getPaperCount: () => number;
}

type PaperStore = PaperState & PaperActions;

/**
 * paperStore - 論文データの管理
 *
 * Zustand + IndexedDB永続化
 */
export const usePaperStore = create<PaperStore>()(
  devtools(
    (set, get) => ({
      // State
      papers: [],
      isLoading: false,
      _db: null,

      // Actions
      addPaper: async (paper) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBに保存（upsert）
        await db.papers.put(paper);

        // Storeを更新（既存の場合は置き換え）
        set((state) => {
          const existingIndex = state.papers.findIndex((p) => p.id === paper.id);
          if (existingIndex >= 0) {
            const newPapers = [...state.papers];
            newPapers[existingIndex] = paper;
            return { papers: newPapers };
          }
          return { papers: [...state.papers, paper] };
        });
      },

      addPapers: async (papers) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBに一括保存
        await db.papers.bulkPut(papers);

        // Storeを更新（公開日の降順でソート）
        set((state) => {
          const paperMap = new Map(state.papers.map((p) => [p.id, p]));
          for (const paper of papers) {
            paperMap.set(paper.id, paper);
          }
          const newPapers = sortPapersByPublishedAt(Array.from(paperMap.values()));
          return { papers: newPapers };
        });
      },

      getPaperById: (id) => {
        return get().papers.find((p) => p.id === id);
      },

      deletePaper: async (id) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBから削除
        await db.papers.delete(id);

        // Storeを更新
        set((state) => ({
          papers: state.papers.filter((p) => p.id !== id),
        }));
      },

      clearAllPapers: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.papers.clear();

        // Storeを更新
        set({ papers: [] });
      },

      getPapersByCategory: (category) => {
        return get().papers.filter((p) => p.categories.includes(category));
      },

      getPaperCount: () => {
        return get().papers.length;
      },
    }),
    { name: "paper-store" }
  )
);

/**
 * 論文を公開日の降順（新しい順）でソートする
 * @param papers ソート対象の論文配列
 * @returns ソート済みの論文配列
 */
const sortPapersByPublishedAt = (papers: Paper[]): Paper[] =>
  [...papers].sort((a, b) => compareDesc(a.publishedAt, b.publishedAt));

/**
 * paperStoreを初期化する
 * IndexedDBからデータをロードしてStoreに設定
 *
 * @param db LuminaDBインスタンス
 */
export const initializePaperStore = async (db: LuminaDB): Promise<void> => {
  usePaperStore.setState({ isLoading: true, _db: db });

  // IndexedDBから全論文をロード（公開日の降順でソート）
  const papers = await db.papers.orderBy("publishedAt").reverse().toArray();

  usePaperStore.setState({
    papers,
    isLoading: false,
  });
};
