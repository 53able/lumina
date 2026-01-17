import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { LuminaDB } from "@/client/db/db";
import type { PaperSummary } from "@/shared/schemas";

/**
 * summaryStore の状態型
 */
interface SummaryState {
  /** 要約データの配列 */
  summaries: PaperSummary[];
  /** ローディング状態 */
  isLoading: boolean;
  /** DBインスタンス（内部用） */
  _db: LuminaDB | null;
}

/**
 * summaryStore のアクション型
 */
interface SummaryActions {
  /** 要約を追加する */
  addSummary: (summary: PaperSummary) => Promise<void>;
  /** 論文IDと言語で要約を取得する */
  getSummaryByPaperIdAndLanguage: (
    paperId: string,
    language: "ja" | "en"
  ) => PaperSummary | undefined;
  /** 論文IDで全言語の要約を取得する */
  getSummariesByPaperId: (paperId: string) => PaperSummary[];
  /** 論文IDで要約を削除する */
  deleteSummariesByPaperId: (paperId: string) => Promise<void>;
  /** 全要約を削除する */
  clearAllSummaries: () => Promise<void>;
  /** 要約が存在するか確認する */
  hasSummary: (paperId: string, language: "ja" | "en") => boolean;
}

type SummaryStore = SummaryState & SummaryActions;

/**
 * summaryStore - 論文要約の管理
 *
 * Zustand + IndexedDB永続化
 */
export const useSummaryStore = create<SummaryStore>()(
  devtools(
    (set, get) => ({
      // State
      summaries: [],
      isLoading: false,
      _db: null,

      // Actions
      addSummary: async (summary) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBに保存
        await db.paperSummaries.add(summary);

        // Storeを更新
        set((state) => ({
          summaries: [...state.summaries, summary],
        }));
      },

      getSummaryByPaperIdAndLanguage: (paperId, language) => {
        return get().summaries.find((s) => s.paperId === paperId && s.language === language);
      },

      getSummariesByPaperId: (paperId) => {
        return get().summaries.filter((s) => s.paperId === paperId);
      },

      deleteSummariesByPaperId: async (paperId) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBから削除
        await db.paperSummaries.where("paperId").equals(paperId).delete();

        // Storeを更新
        set((state) => ({
          summaries: state.summaries.filter((s) => s.paperId !== paperId),
        }));
      },

      clearAllSummaries: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.paperSummaries.clear();

        // Storeを更新
        set({ summaries: [] });
      },

      hasSummary: (paperId, language) => {
        return get().summaries.some((s) => s.paperId === paperId && s.language === language);
      },
    }),
    { name: "summary-store" }
  )
);

/**
 * summaryStoreを初期化する
 * IndexedDBからデータをロードしてStoreに設定
 *
 * @param db LuminaDBインスタンス
 */
export const initializeSummaryStore = async (db: LuminaDB): Promise<void> => {
  useSummaryStore.setState({ isLoading: true, _db: db });

  // IndexedDBから全要約をロード
  const summaries = await db.paperSummaries.toArray();

  useSummaryStore.setState({
    summaries,
    isLoading: false,
  });
};
