import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { LuminaDB } from "@/client/db/db";
import type { InteractionType, UserInteraction } from "@/shared/schemas";
import { now } from "@/shared/utils/dateTime";

/**
 * interactionStore の状態型
 */
interface InteractionState {
  /** インタラクションの配列 */
  interactions: UserInteraction[];
  /** ローディング状態 */
  isLoading: boolean;
  /** DBインスタンス（内部用） */
  _db: LuminaDB | null;
}

/**
 * interactionStore のアクション型
 */
interface InteractionActions {
  /** いいねをトグルする */
  toggleLike: (paperId: string) => Promise<void>;
  /** ブックマークをトグルする */
  toggleBookmark: (paperId: string) => Promise<void>;
  /** いいね済み論文IDセットを取得する */
  getLikedPaperIds: () => Set<string>;
  /** ブックマーク済み論文IDセットを取得する */
  getBookmarkedPaperIds: () => Set<string>;
  /** 論文IDでインタラクションを取得する */
  getInteractionsByPaperId: (paperId: string) => UserInteraction[];
  /** 全インタラクションを削除する */
  clearAllInteractions: () => Promise<void>;
}

type InteractionStore = InteractionState & InteractionActions;

/**
 * 指定タイプのインタラクションが存在するか確認
 */
const findInteraction = (
  interactions: UserInteraction[],
  paperId: string,
  type: InteractionType
): UserInteraction | undefined => {
  return interactions.find((i) => i.paperId === paperId && i.type === type);
};

/**
 * interactionStore - いいね/ブックマークの状態管理
 *
 * Zustand + IndexedDB永続化
 */
export const useInteractionStore = create<InteractionStore>()(
  devtools(
    (set, get) => ({
      // State
      interactions: [],
      isLoading: false,
      _db: null,

      // Actions
      toggleLike: async (paperId) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const existing = findInteraction(get().interactions, paperId, "like");

        if (existing) {
          // いいねを取り消す
          await db.userInteractions.delete(existing.id);
          set((state) => ({
            interactions: state.interactions.filter((i) => i.id !== existing.id),
          }));
        } else {
          // いいねを追加
          const newInteraction: UserInteraction = {
            id: crypto.randomUUID(),
            paperId,
            type: "like",
            createdAt: now(),
          };
          await db.userInteractions.add(newInteraction);
          set((state) => ({
            interactions: [...state.interactions, newInteraction],
          }));
        }
      },

      toggleBookmark: async (paperId) => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        const existing = findInteraction(get().interactions, paperId, "bookmark");

        if (existing) {
          // ブックマークを取り消す
          await db.userInteractions.delete(existing.id);
          set((state) => ({
            interactions: state.interactions.filter((i) => i.id !== existing.id),
          }));
        } else {
          // ブックマークを追加
          const newInteraction: UserInteraction = {
            id: crypto.randomUUID(),
            paperId,
            type: "bookmark",
            createdAt: now(),
          };
          await db.userInteractions.add(newInteraction);
          set((state) => ({
            interactions: [...state.interactions, newInteraction],
          }));
        }
      },

      getLikedPaperIds: () => {
        const interactions = get().interactions;
        return new Set(interactions.filter((i) => i.type === "like").map((i) => i.paperId));
      },

      getBookmarkedPaperIds: () => {
        const interactions = get().interactions;
        return new Set(interactions.filter((i) => i.type === "bookmark").map((i) => i.paperId));
      },

      getInteractionsByPaperId: (paperId) => {
        return get().interactions.filter((i) => i.paperId === paperId);
      },

      clearAllInteractions: async () => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");

        // IndexedDBをクリア
        await db.userInteractions.clear();

        // Storeを更新
        set({ interactions: [] });
      },
    }),
    { name: "interaction-store" }
  )
);

/**
 * interactionStoreを初期化する
 * IndexedDBからデータをロードしてStoreに設定
 *
 * @param db LuminaDBインスタンス
 */
export const initializeInteractionStore = async (db: LuminaDB): Promise<void> => {
  useInteractionStore.setState({ isLoading: true, _db: db });

  // IndexedDBから全インタラクションをロード
  const interactions = await db.userInteractions.toArray();

  useInteractionStore.setState({
    interactions,
    isLoading: false,
  });
};
