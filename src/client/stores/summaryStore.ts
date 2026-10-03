import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PaperSummary } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";

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
  /**
   * 要約を追加する（同じ論文・言語の既存の要約は旧版として残す。表示には最新の1件を使う）
   */
  addSummary: (summary: PaperSummary) => Promise<void>;
  /** 論文・言語の最新の要約を部分更新する（説明文のみの生成で使う。要約は置き換えない） */
  updateSummary: (
    paperId: string,
    language: "ja" | "en",
    changes: Partial<Pick<PaperSummary, "explanation" | "targetAudience" | "whyRead">>
  ) => Promise<void>;
  /** 論文IDと言語で最新の要約を取得する */
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
 * 論文・言語の最新の要約（最後に追加されたもの）の位置を返す。なければ -1
 * （ES2022 の lib には findLastIndex がないため、後ろから探す）
 */
const findLatestIndex = (
  summaries: PaperSummary[],
  paperId: string,
  language: "ja" | "en"
): number => {
  for (let i = summaries.length - 1; i >= 0; i--) {
    if (summaries[i].paperId === paperId && summaries[i].language === language) return i;
  }
  return -1;
};

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

      updateSummary: async (paperId, language, changes) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // 最新のレコード（主キーが最大）だけを更新する。旧版は変更しない
        // （主キーは自動採番でスキーマ型に含まれないため、:id で指定する）
        const keys = await db.paperSummaries
          .where("[paperId+language]")
          .equals([paperId, language])
          .primaryKeys();
        const latestKey = keys.at(-1);
        if (latestKey === undefined) throw new Error("Summary not found");
        await db.paperSummaries.where(":id").equals(latestKey).modify(changes);

        // Storeを更新
        set((state) => {
          const index = findLatestIndex(state.summaries, paperId, language);
          if (index === -1) return state;
          const summaries = [...state.summaries];
          summaries[index] = { ...summaries[index], ...changes };
          return { summaries };
        });
      },

      getSummaryByPaperIdAndLanguage: (paperId, language) => {
        // 同じ論文・言語に複数の版がある場合は最新（最後に追加された）を返す
        const { summaries } = get();
        const index = findLatestIndex(summaries, paperId, language);
        return index === -1 ? undefined : summaries[index];
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
