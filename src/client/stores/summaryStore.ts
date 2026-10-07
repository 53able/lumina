import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { type PaperSummary, SUMMARY_CORRECTION_MAX_LENGTH } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";
import {
  isSameRecords,
  notifyDbChange,
  reloadUnlessChanged,
  subscribeDbChanges,
} from "../lib/dbChangeChannel";

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
  /**
   * 指定した版に利用者の訂正文を保存する（空白だけの文字列なら訂正を削除する）
   * 採用版ではなく版の主キーで指定する: 編集中に別の版が採用されても、利用者が見ていた版に付けるため
   */
  saveCorrection: (id: number, text: string) => Promise<void>;
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
 * IndexedDB から論文・言語の版を主キーつきで読む（保存順）
 * 呼び出し側のトランザクション内で使い、Store の控えではなく DB の最新状態を基準にする
 */
const readVersions = async (
  db: LuminaDB,
  paperId: string,
  language: "ja" | "en"
): Promise<SummaryVersion[]> => {
  const versions: SummaryVersion[] = [];
  // 複合インデックスの同じキーは主キー順に並ぶため、保存順で読める
  await db.paperSummaries
    .where("[paperId+language]")
    .equals([paperId, language])
    .each((summary, cursor) => {
      versions.push({ ...summary, id: cursor.primaryKey as unknown as number });
    });
  return versions;
};

/**
 * IndexedDB 上の論文・言語の版のうち、指定した版だけを採用指定にする
 * （呼び出し側のトランザクション内で使う。同じ論文・言語で adopted: true は常に1件以下）
 */
const markAdoptedInDb = async (
  db: LuminaDB,
  versions: SummaryVersion[],
  adoptedId: number
): Promise<void> => {
  for (const v of versions) {
    const adopted = v.id === adoptedId;
    if (v.adopted !== adopted) {
      await db.paperSummaries.where(":id").equals(v.id).modify({ adopted });
    }
  }
};

/** Store の論文・言語の版のうち、指定した版だけを採用指定にする（他の論文・言語の版はそのまま） */
const withAdopted = (
  summaries: SummaryVersion[],
  paperId: string,
  language: "ja" | "en",
  adoptedId: number
): SummaryVersion[] =>
  summaries.map((s) =>
    s.paperId === paperId && s.language === language ? { ...s, adopted: s.id === adoptedId } : s
  );

/** 版の主キーから対象の版を読む（呼び出し側のトランザクション内で使う） */
const readVersionById = async (db: LuminaDB, id: number): Promise<PaperSummary> => {
  const target = await db.paperSummaries.where(":id").equals(id).first();
  if (!target) throw new Error("Summary not found");
  return target;
};

/**
 * summaryStore - 論文要約の管理
 *
 * Zustand + IndexedDB永続化
 *
 * 版の追加・採用・破棄は、同じ論文・言語の版をトランザクション内で DB から読み直して書き込み、
 * Store には差分（追加・削除・採用指定の書き換え）だけを反映する。
 * await 前の Store の控えで丸ごと置き換えると、並行する他の操作の結果を消してしまうため。
 * また、同じ IndexedDB を別のタブも書き換えうる（Store は起動時に読んだ控えにすぎない）ため、
 * 採用版の判定と採用指定の書き換えは、Store ではなく DB の内容を基準に1つのトランザクションで行う。
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
        const id = await db.transaction("rw", db.paperSummaries, async () => {
          const addedId = (await db.paperSummaries.add({
            ...summary,
            adopted: true,
          })) as unknown as number;
          await markAdoptedInDb(
            db,
            await readVersions(db, summary.paperId, summary.language),
            addedId
          );
          return addedId;
        });

        // Storeを更新（別タブの変更の読み直しで追加済みの場合があるため、同じ版は除いてから足す）
        set((state) => ({
          summaries: [
            ...withAdopted(
              state.summaries.filter((s) => s.id !== id),
              summary.paperId,
              summary.language,
              id
            ),
            { ...summary, id, adopted: true },
          ],
        }));
        notifyDbChange(db, { table: "paperSummaries", paperIds: [summary.paperId] });
      },

      updateSummary: async (paperId, language, changes) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // 採用版だけを更新する。他の版は変更しない
        const adoptedId = await db.transaction("rw", db.paperSummaries, async () => {
          const adopted = getAdoptedSummaries(
            await readVersions(db, paperId, language),
            language
          ).get(paperId);
          if (!adopted) throw new Error("Summary not found");
          await db.paperSummaries.where(":id").equals(adopted.id).modify(changes);
          return adopted.id;
        });

        // Storeを更新
        set((state) => ({
          summaries: state.summaries.map((s) => (s.id === adoptedId ? { ...s, ...changes } : s)),
        }));
        notifyDbChange(db, { table: "paperSummaries", paperIds: [paperId] });
      },

      saveCorrection: async (id, text) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");
        const trimmed = text.trim();
        if (trimmed.length > SUMMARY_CORRECTION_MAX_LENGTH) {
          throw new Error("Correction is too long");
        }
        const userCorrection = trimmed ? { text: trimmed, updatedAt: new Date() } : undefined;

        // 版が破棄されていないかを DB で確かめてから、その版の訂正だけを書き換える（AI生成の各フィールドは変更しない）
        const target = await db.transaction("rw", db.paperSummaries, async () => {
          const found = await readVersionById(db, id);
          await db.paperSummaries
            .where(":id")
            .equals(id)
            .modify((s) => {
              if (userCorrection) s.userCorrection = userCorrection;
              else delete s.userCorrection;
            });
          return found;
        });

        // Storeを更新
        set((state) => ({
          summaries: state.summaries.map((s) => {
            if (s.id !== id) return s;
            const { userCorrection: _removed, ...rest } = s;
            return userCorrection ? { ...rest, userCorrection } : rest;
          }),
        }));
        notifyDbChange(db, { table: "paperSummaries", paperIds: [target.paperId] });
      },

      getSummaryByPaperIdAndLanguage: (paperId, language) => {
        // 同じ論文・言語に複数の版がある場合は採用版を返す
        return findAdopted(get().summaries, paperId, language);
      },

      adoptSummary: async (id) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const target = await db.transaction("rw", db.paperSummaries, async () => {
          const found = await readVersionById(db, id);
          await markAdoptedInDb(db, await readVersions(db, found.paperId, found.language), id);
          return found;
        });

        // Storeを更新
        set((state) => ({
          summaries: withAdopted(state.summaries, target.paperId, target.language, id),
        }));
        notifyDbChange(db, { table: "paperSummaries", paperIds: [target.paperId] });
      },

      discardSummary: async (id) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const { target, fallbackId } = await db.transaction("rw", db.paperSummaries, async () => {
          const found = await readVersionById(db, id);
          const versions = await readVersions(db, found.paperId, found.language);
          const wasAdopted =
            getAdoptedSummaries(versions, found.language).get(found.paperId)?.id === id;

          await db.paperSummaries.where(":id").equals(id).delete();

          // 採用版を破棄した場合は、残りの版のうち最新の版を採用版にする（再読込後も同じ版になるよう保存する）
          const remaining = versions.filter((v) => v.id !== id);
          const fallback = wasAdopted ? remaining.at(-1) : undefined;
          if (fallback) await markAdoptedInDb(db, remaining, fallback.id);
          return { target: found, fallbackId: fallback?.id };
        });

        // Storeを更新
        set((state) => {
          const summaries = state.summaries.filter((s) => s.id !== id);
          return {
            summaries:
              fallbackId === undefined
                ? summaries
                : withAdopted(summaries, target.paperId, target.language, fallbackId),
          };
        });
        notifyDbChange(db, { table: "paperSummaries", paperIds: [target.paperId] });
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
        notifyDbChange(db, { table: "paperSummaries", paperIds: [paperId] });
      },

      clearAllSummaries: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.paperSummaries.clear();

        // Storeを更新
        set({ summaries: [] });
        notifyDbChange(db, { table: "paperSummaries", paperIds: null });
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
  unsubscribeRemoteChanges?.();
  unsubscribeRemoteChanges = subscribeDbChanges(db, "paperSummaries", ({ paperIds }) => {
    return reloadSummaries(db, paperIds).catch((error: unknown) => {
      console.warn("Failed to reload summaries changed in another tab", error);
    });
  });

  // 読み込み中に別タブの変更を反映した場合は読み直す（読み込み開始時点の古い全件で反映を消さない）
  await reloadUnlessChanged(
    () => useSummaryStore.getState().summaries,
    () => readSummaries(db, null),
    (summaries) => useSummaryStore.setState({ summaries, isLoading: false })
  );
};

/** 別タブの変更の購読の解除関数（再初期化で二重に購読しないため） */
let unsubscribeRemoteChanges: (() => void) | null = null;

// 開発時の HMR でモジュールが置き換わるとき、古いストアへの購読を解除する
import.meta.hot?.dispose(() => unsubscribeRemoteChanges?.());

/**
 * IndexedDB から要約を主キーつきで読む（paperIds が null なら全件）
 * 主キー順 = 保存順。論文IDの索引で読む場合も、同じ論文の版は主キー順に並ぶ
 */
const readSummaries = async (
  db: LuminaDB,
  paperIds: string[] | null
): Promise<SummaryVersion[]> => {
  const summaries: SummaryVersion[] = [];
  const collection =
    paperIds === null
      ? db.paperSummaries.toCollection()
      : db.paperSummaries.where("paperId").anyOf(paperIds);
  await collection.each((summary, cursor) => {
    summaries.push({ ...summary, id: cursor.primaryKey as unknown as number });
  });
  return summaries;
};

/**
 * 別タブで変更された論文の要約を IndexedDB から読み直し、Store のその論文の版を置き換える
 * （別タブで生成した要約を未生成と誤認して重複生成しないため。Issue #109）
 */
const reloadSummaries = (db: LuminaDB, paperIds: string[] | null): Promise<void> =>
  reloadUnlessChanged(
    () => useSummaryStore.getState().summaries,
    () => readSummaries(db, paperIds),
    (fresh) => {
      if (paperIds === null) {
        if (isSameRecords(useSummaryStore.getState().summaries, fresh)) return;
        useSummaryStore.setState({ summaries: fresh });
        return;
      }
      const changed = new Set(paperIds);
      useSummaryStore.setState((state) => ({
        summaries: [...state.summaries.filter((s) => !changed.has(s.paperId)), ...fresh],
      }));
    }
  );
