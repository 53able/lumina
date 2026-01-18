import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLuminaDb, type LuminaDB } from "@/client/db/db";
import type { UserInteraction } from "@/shared/schemas";
import { now } from "@/shared/utils/dateTime";

/**
 * interactionStore テスト
 *
 * Design Docsに基づく仕様:
 * - いいね/ブックマークの状態管理
 * - IndexedDBへの永続化
 * - 論文IDでのフィルタリング
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプルインタラクションデータ
const createSampleInteraction = (overrides: Partial<UserInteraction> = {}): UserInteraction => ({
  id: crypto.randomUUID(),
  paperId: "2401.00001",
  type: "like",
  createdAt: now(),
  ...overrides,
});

describe("interactionStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`interactionStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      const state = useInteractionStore.getState();

      expect(state.interactions).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingInteraction = createSampleInteraction({
        id: "test-id-1",
        paperId: "2401.00001",
        type: "like",
      });
      await mockDb.userInteractions.add(existingInteraction);

      // Act
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      const state = useInteractionStore.getState();

      // Assert
      expect(state.interactions).toHaveLength(1);
      expect(state.interactions[0]!.paperId).toBe("2401.00001");
      expect(state.interactions[0]!.type).toBe("like");
    });
  });

  describe("いいね操作", () => {
    it("正常系: 論文にいいねできる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Act
      await useInteractionStore.getState().toggleLike("2401.00001");

      // Assert - Store
      const state = useInteractionStore.getState();
      const likedIds = state.getLikedPaperIds();
      expect(likedIds.has("2401.00001")).toBe(true);

      // Assert - IndexedDB永続化
      const dbInteractions = await mockDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbInteractions).toHaveLength(1);
      expect(dbInteractions[0]!.type).toBe("like");
    });

    it("正常系: いいねを取り消せる（トグル）", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange - いいねを付ける
      await useInteractionStore.getState().toggleLike("2401.00001");
      expect(useInteractionStore.getState().getLikedPaperIds().has("2401.00001")).toBe(true);

      // Act - いいねを取り消す
      await useInteractionStore.getState().toggleLike("2401.00001");

      // Assert - Store
      const state = useInteractionStore.getState();
      expect(state.getLikedPaperIds().has("2401.00001")).toBe(false);

      // Assert - IndexedDB
      const dbInteractions = await mockDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .filter((i) => i.type === "like")
        .toArray();
      expect(dbInteractions).toHaveLength(0);
    });

    it("正常系: いいね済み論文IDセットを取得できる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange
      await useInteractionStore.getState().toggleLike("2401.00001");
      await useInteractionStore.getState().toggleLike("2401.00002");
      await useInteractionStore.getState().toggleBookmark("2401.00003"); // ブックマークは含まれない

      // Act
      const likedIds = useInteractionStore.getState().getLikedPaperIds();

      // Assert
      expect(likedIds.size).toBe(2);
      expect(likedIds.has("2401.00001")).toBe(true);
      expect(likedIds.has("2401.00002")).toBe(true);
      expect(likedIds.has("2401.00003")).toBe(false);
    });
  });

  describe("ブックマーク操作", () => {
    it("正常系: 論文にブックマークできる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Act
      await useInteractionStore.getState().toggleBookmark("2401.00001");

      // Assert - Store
      const state = useInteractionStore.getState();
      const bookmarkedIds = state.getBookmarkedPaperIds();
      expect(bookmarkedIds.has("2401.00001")).toBe(true);

      // Assert - IndexedDB永続化
      const dbInteractions = await mockDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbInteractions).toHaveLength(1);
      expect(dbInteractions[0]!.type).toBe("bookmark");
    });

    it("正常系: ブックマークを取り消せる（トグル）", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange - ブックマークを付ける
      await useInteractionStore.getState().toggleBookmark("2401.00001");
      expect(useInteractionStore.getState().getBookmarkedPaperIds().has("2401.00001")).toBe(true);

      // Act - ブックマークを取り消す
      await useInteractionStore.getState().toggleBookmark("2401.00001");

      // Assert - Store
      const state = useInteractionStore.getState();
      expect(state.getBookmarkedPaperIds().has("2401.00001")).toBe(false);

      // Assert - IndexedDB
      const dbInteractions = await mockDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .filter((i) => i.type === "bookmark")
        .toArray();
      expect(dbInteractions).toHaveLength(0);
    });

    it("正常系: ブックマーク済み論文IDセットを取得できる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange
      await useInteractionStore.getState().toggleBookmark("2401.00001");
      await useInteractionStore.getState().toggleBookmark("2401.00002");
      await useInteractionStore.getState().toggleLike("2401.00003"); // いいねは含まれない

      // Act
      const bookmarkedIds = useInteractionStore.getState().getBookmarkedPaperIds();

      // Assert
      expect(bookmarkedIds.size).toBe(2);
      expect(bookmarkedIds.has("2401.00001")).toBe(true);
      expect(bookmarkedIds.has("2401.00002")).toBe(true);
      expect(bookmarkedIds.has("2401.00003")).toBe(false);
    });
  });

  describe("いいねとブックマークの独立性", () => {
    it("正常系: 同じ論文にいいねとブックマークを両方付けられる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Act
      await useInteractionStore.getState().toggleLike("2401.00001");
      await useInteractionStore.getState().toggleBookmark("2401.00001");

      // Assert
      const state = useInteractionStore.getState();
      expect(state.getLikedPaperIds().has("2401.00001")).toBe(true);
      expect(state.getBookmarkedPaperIds().has("2401.00001")).toBe(true);

      // Assert - IndexedDB（2つのレコードが存在）
      const dbInteractions = await mockDb.userInteractions
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbInteractions).toHaveLength(2);
    });
  });

  describe("論文IDでインタラクション取得", () => {
    it("正常系: 論文IDでインタラクションを取得できる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange
      await useInteractionStore.getState().toggleLike("2401.00001");
      await useInteractionStore.getState().toggleBookmark("2401.00001");

      // Act
      const interactions = useInteractionStore.getState().getInteractionsByPaperId("2401.00001");

      // Assert
      expect(interactions).toHaveLength(2);
    });
  });

  describe("全インタラクションのクリア", () => {
    it("正常系: 全インタラクションを削除できる", async () => {
      const { useInteractionStore, initializeInteractionStore } = await import(
        "./interactionStore"
      );
      await initializeInteractionStore(mockDb);

      // Arrange
      await useInteractionStore.getState().toggleLike("2401.00001");
      await useInteractionStore.getState().toggleBookmark("2401.00002");

      // Act
      await useInteractionStore.getState().clearAllInteractions();

      // Assert - Store
      const state = useInteractionStore.getState();
      expect(state.interactions).toHaveLength(0);
      expect(state.getLikedPaperIds().size).toBe(0);
      expect(state.getBookmarkedPaperIds().size).toBe(0);

      // Assert - IndexedDB
      const dbInteractions = await mockDb.userInteractions.toArray();
      expect(dbInteractions).toHaveLength(0);
    });
  });
});
