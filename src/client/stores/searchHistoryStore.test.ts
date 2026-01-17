import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLuminaDb, type LuminaDB } from "@/client/db/db";
import type { SearchHistory } from "@/shared/schemas";

/**
 * searchHistoryStore テスト
 *
 * Design Docsに基づく仕様:
 * - 検索履歴の管理（CRUD操作）
 * - IndexedDBへの永続化
 * - 最新順でのソート
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプル検索履歴データ
const createSampleHistory = (overrides: Partial<SearchHistory> = {}): SearchHistory => ({
  id: crypto.randomUUID(),
  originalQuery: "強化学習",
  expandedQuery: {
    original: "強化学習",
    english: "reinforcement learning",
    synonyms: ["RL", "reward-based learning"],
    searchText: "reinforcement learning RL reward-based learning",
  },
  queryEmbedding: Array(1536).fill(0.1),
  resultCount: 42,
  createdAt: new Date(),
  ...overrides,
});

describe("searchHistoryStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`searchHistoryStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const state = useSearchHistoryStore.getState();

      expect(state.histories).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingHistory = createSampleHistory({ id: "test-id-1" });
      await mockDb.searchHistories.add(existingHistory);

      // Act
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const state = useSearchHistoryStore.getState();

      // Assert
      expect(state.histories).toHaveLength(1);
      expect(state.histories[0].originalQuery).toBe("強化学習");
    });
  });

  describe("検索履歴の追加", () => {
    it("正常系: 検索履歴を追加できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const history = createSampleHistory({ id: "test-id-1" });

      // Act
      await useSearchHistoryStore.getState().addHistory(history);

      // Assert - Store
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toHaveLength(1);
      expect(state.histories[0].originalQuery).toBe("強化学習");

      // Assert - IndexedDB永続化
      const dbHistory = await mockDb.searchHistories.get("test-id-1");
      expect(dbHistory).toBeDefined();
    });

    it("正常系: 検索履歴は新しい順にソートされる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const oldHistory = createSampleHistory({
        id: "old-id",
        originalQuery: "古い検索",
        createdAt: new Date("2024-01-01"),
      });
      const newHistory = createSampleHistory({
        id: "new-id",
        originalQuery: "新しい検索",
        createdAt: new Date("2024-01-02"),
      });

      // Act - 古い方を先に追加
      await useSearchHistoryStore.getState().addHistory(oldHistory);
      await useSearchHistoryStore.getState().addHistory(newHistory);

      // Assert - 新しい方が先に来る
      const state = useSearchHistoryStore.getState();
      expect(state.histories[0].originalQuery).toBe("新しい検索");
      expect(state.histories[1].originalQuery).toBe("古い検索");
    });
  });

  describe("検索履歴の取得", () => {
    it("正常系: IDで検索履歴を取得できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const history = createSampleHistory({ id: "test-id-1" });
      await useSearchHistoryStore.getState().addHistory(history);

      // Act
      const retrieved = useSearchHistoryStore.getState().getHistoryById("test-id-1");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.originalQuery).toBe("強化学習");
    });

    it("正常系: 最新N件の検索履歴を取得できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      // 5件追加
      for (let i = 0; i < 5; i++) {
        await useSearchHistoryStore.getState().addHistory(
          createSampleHistory({
            id: `id-${i}`,
            originalQuery: `検索${i}`,
            createdAt: new Date(2024, 0, i + 1),
          })
        );
      }

      // Act - 最新3件を取得
      const recent = useSearchHistoryStore.getState().getRecentHistories(3);

      // Assert
      expect(recent).toHaveLength(3);
      expect(recent[0].originalQuery).toBe("検索4"); // 最新
    });
  });

  describe("検索履歴の削除", () => {
    it("正常系: IDで検索履歴を削除できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const history = createSampleHistory({ id: "test-id-1" });
      await useSearchHistoryStore.getState().addHistory(history);

      // Act
      await useSearchHistoryStore.getState().deleteHistory("test-id-1");

      // Assert - Store
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toHaveLength(0);

      // Assert - IndexedDB
      const dbHistory = await mockDb.searchHistories.get("test-id-1");
      expect(dbHistory).toBeUndefined();
    });
  });

  describe("全検索履歴のクリア", () => {
    it("正常系: 全検索履歴を削除できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "id-1" }));
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "id-2" }));

      // Act
      await useSearchHistoryStore.getState().clearAllHistories();

      // Assert - Store
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toHaveLength(0);

      // Assert - IndexedDB
      const dbHistories = await mockDb.searchHistories.toArray();
      expect(dbHistories).toHaveLength(0);
    });
  });

  describe("検索履歴数の取得", () => {
    it("正常系: 検索履歴数を取得できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "id-1" }));
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "id-2" }));

      // Act
      const count = useSearchHistoryStore.getState().getHistoryCount();

      // Assert
      expect(count).toBe(2);
    });
  });
});
