import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PaperSummary } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";

/**
 * 保存済みの要約の版（IndexedDB の主キーを id として持つ）
 */
export type SummaryVersion = PaperSummary & {
  /** IndexedDB の主キー（自動採番）。版の採用・破棄の対象指定に使う */
  id: number;
};

/**
 * summaryStore の状態型
 */
interface SummaryState {
  /** 要約データの配列（保存順。同じ論文・言語に複数の版がありうる） */
  summaries: SummaryVersion[];
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
   * 要約を新しい版として追加し、採用版にする（同じ論文・言語の既存の要約は旧版として残す）
   */
  addSummary: (summary: PaperSummary) => Promise<void>;
  /** 論文・言語の採用版を部分更新する（説明文のみの生成で使う。要約は置き換えない） */
  updateSummary: (
    paperId: string,
    language: "ja" | "en",
    changes: Partial<Pick<PaperSummary, "explanation" | "targetAudience" | "whyRead">>
  ) => Promise<void>;
  /** 論文IDと言語で採用版の要約を取得する */
  getSummaryByPaperIdAndLanguage: (
    paperId: string,
    language: "ja" | "en"
  ) => SummaryVersion | undefined;
  /** 指定した版を採用版にする（同じ論文・言語の他の版は採用を外す） */
  adoptSummary: (id: number) => Promise<void>;
  /** 指定した版を破棄する。採用版を破棄した場合は、残りの版のうち最新の版を採用版にする */
  discardSummary: (id: number) => Promise<void>;
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
 * 論文・言語ごとの採用版を返す（キーは paperId）
 *
 * 採用指定（adopted: true）の版があればそれを、なければ最新の版（最後に保存したもの）を採用版とみなす。
 * 採用指定は版の採用・追加時にだけ付くため、指定のない既存データは従来どおり最新の版が表示される。
 */
export const getAdoptedSummaries = (
  summaries: SummaryVersion[],
  language: "ja" | "en"
): Map<string, SummaryVersion> => {
  const adoptedByPaperId = new Map<string, SummaryVersion>();
  for (const s of summaries) {
    if (s.language !== language) continue;
    // 採用指定のある版は、指定のない後の版に上書きさせない
    if (s.adopted || !adoptedByPaperId.get(s.paperId)?.adopted) {
      adoptedByPaperId.set(s.paperId, s);
    }
  }
  return adoptedByPaperId;
};

/** 論文・言語の版を保存順（古い順）で返す */
export const getSummaryVersions = (
  summaries: SummaryVersion[],
  paperId: string,
  language: "ja" | "en"
): SummaryVersion[] => summaries.filter((s) => s.paperId === paperId && s.language === language);

/** 論文・言語の採用版を返す */
const findAdopted = (
  summaries: SummaryVersion[],
  paperId: string,
  language: "ja" | "en"
): SummaryVersion | undefined =>
  getAdoptedSummaries(getSummaryVersions(summaries, paperId, language), language).get(paperId);

/**
 * 同じ論文・言語の版のうち、指定した版だけを採用指定にする（IndexedDB と Store の両方）
 */
const markAdopted = async (
  db: LuminaDB,
  summaries: SummaryVersion[],
  target: SummaryVersion
): Promise<SummaryVersion[]> => {
  const siblings = getSummaryVersions(summaries, target.paperId, target.language);
  await db.transaction("rw", db.paperSummaries, async () => {
    for (const s of siblings) {
      if (s.id !== target.id && s.adopted) {
        await db.paperSummaries.where(":id").equals(s.id).modify({ adopted: false });
      }
    }
    await db.paperSummaries.where(":id").equals(target.id).modify({ adopted: true });
  });
  return summaries.map((s) =>
    s.paperId === target.paperId && s.language === target.language
      ? { ...s, adopted: s.id === target.id }
      : s
  );
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

        // 新しい版として保存し、同じトランザクションで採用版にする
        // （主キーは自動採番でスキーマ型に含まれないため number として扱う）
        const summaries = await db.transaction("rw", db.paperSummaries, async () => {
          const id = (await db.paperSummaries.add(summary)) as unknown as number;
          const added = { ...summary, id };
          return markAdopted(db, [...get().summaries, added], added);
        });

        // Storeを更新
        set({ summaries });
      },

      updateSummary: async (paperId, language, changes) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // 採用版だけを更新する。他の版は変更しない
        // （主キーは自動採番でスキーマ型に含まれないため、:id で指定する）
        const adopted = findAdopted(get().summaries, paperId, language);
        if (!adopted) throw new Error("Summary not found");
        await db.paperSummaries.where(":id").equals(adopted.id).modify(changes);

        // Storeを更新
        set((state) => ({
          summaries: state.summaries.map((s) => (s.id === adopted.id ? { ...s, ...changes } : s)),
        }));
      },

      getSummaryByPaperIdAndLanguage: (paperId, language) => {
        // 同じ論文・言語に複数の版がある場合は採用版を返す
        return findAdopted(get().summaries, paperId, language);
      },

      adoptSummary: async (id) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const target = get().summaries.find((s) => s.id === id);
        if (!target) throw new Error("Summary not found");
        const summaries = await markAdopted(db, get().summaries, target);
        set({ summaries });
      },

      discardSummary: async (id) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const target = get().summaries.find((s) => s.id === id);
        if (!target) throw new Error("Summary not found");
        const wasAdopted =
          findAdopted(get().summaries, target.paperId, target.language)?.id === target.id;

        await db.paperSummaries.where(":id").equals(id).delete();
        let summaries = get().summaries.filter((s) => s.id !== id);

        // 採用版を破棄した場合は、残りの版のうち最新の版を採用版にする（再読込後も同じ版になるよう保存する）
        const fallback = getSummaryVersions(summaries, target.paperId, target.language).at(-1);
        if (wasAdopted && fallback) {
          summaries = await markAdopted(db, summaries, fallback);
        }
        set({ summaries });
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

  // IndexedDBから全要約を主キーつきでロード（主キー順 = 保存順）
  const summaries: SummaryVersion[] = [];
  await db.paperSummaries.each((summary, cursor) => {
    summaries.push({ ...summary, id: cursor.primaryKey as unknown as number });
  });

  useSummaryStore.setState({
    summaries,
    isLoading: false,
  });
};
