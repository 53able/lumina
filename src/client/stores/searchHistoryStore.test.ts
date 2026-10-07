import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHistory } from "../../shared/schemas/index";
import { now, parseISO } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { DB_CHANGE_CHANNEL_NAME, type DbChangeMessage } from "../lib/dbChangeChannel";

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
  createdAt: now(),
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
      expect(state.histories[0]?.originalQuery).toBe("強化学習");
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
      expect(state.histories[0]?.originalQuery).toBe("強化学習");

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
        createdAt: parseISO("2024-01-01"),
      });
      const newHistory = createSampleHistory({
        id: "new-id",
        originalQuery: "新しい検索",
        createdAt: parseISO("2024-01-02"),
      });

      // Act - 古い方を先に追加
      await useSearchHistoryStore.getState().addHistory(oldHistory);
      await useSearchHistoryStore.getState().addHistory(newHistory);

      // Assert - 新しい方が先に来る
      const state = useSearchHistoryStore.getState();
      expect(state.histories[0]?.originalQuery).toBe("新しい検索");
      expect(state.histories[1]?.originalQuery).toBe("古い検索");
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

  describe("削除の取り消し（Undo）", () => {
    it("正常系: 削除した履歴を元に戻すと、全フィールドが元のまま復元され再読み込み後も残る", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);

      const older = createSampleHistory({
        id: "older-id",
        originalQuery: "古い検索",
        createdAt: parseISO("2024-01-01T00:00:00Z"),
      });
      const target = createSampleHistory({
        id: "target-id",
        originalQuery: "強化学習",
        expandedQuery: {
          original: "強化学習",
          english: "reinforcement learning",
          synonyms: ["RL"],
          searchText: "edited search text",
          originalSearchText: "reinforcement learning RL",
        },
        queryEmbedding: Array.from({ length: 8 }, (_, i) => i / 10),
        resultCount: 7,
        createdAt: parseISO("2024-01-02T03:04:05Z"),
      });
      const newer = createSampleHistory({
        id: "newer-id",
        originalQuery: "新しい検索",
        createdAt: parseISO("2024-01-03T00:00:00Z"),
      });
      for (const h of [older, target, newer]) {
        await useSearchHistoryStore.getState().addHistory(h);
      }

      await useSearchHistoryStore.getState().deleteHistory("target-id");
      expect(await mockDb.searchHistories.get("target-id")).toBeUndefined();
      expect(useSearchHistoryStore.getState().deletedHistories).toEqual([target]);

      await useSearchHistoryStore.getState().restoreHistory("target-id");

      const state = useSearchHistoryStore.getState();
      expect(state.deletedHistories).toEqual([]);
      expect(state.histories.map((h) => h.id)).toEqual(["newer-id", "target-id", "older-id"]);
      expect(state.histories[1]).toEqual(target);

      // 再読み込み相当: DBから読み直しても同じレコードで並び順も保たれる
      await initializeSearchHistoryStore(mockDb);
      const reloaded = useSearchHistoryStore.getState().histories;
      expect(reloaded.map((h) => h.id)).toEqual(["newer-id", "target-id", "older-id"]);
      expect(reloaded[1]).toEqual(target);
    });

    it("正常系: 削除の退避は再読み込み（再初期化）で破棄される", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "test-id-1" }));
      await useSearchHistoryStore.getState().deleteHistory("test-id-1");

      await initializeSearchHistoryStore(mockDb);

      expect(useSearchHistoryStore.getState().deletedHistories).toEqual([]);
    });

    it("異常系: DB削除に失敗すると履歴を残し、エラーを保持し、再試行で削除できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "test-id-1" }));
      const deleteSpy = vi
        .spyOn(mockDb.searchHistories, "delete")
        .mockRejectedValueOnce(new Error("QuotaExceededError"));

      await expect(
        useSearchHistoryStore.getState().deleteHistory("test-id-1")
      ).resolves.toBeUndefined();

      let state = useSearchHistoryStore.getState();
      expect(state.histories.map((h) => h.id)).toEqual(["test-id-1"]);
      expect(state.deletedHistories).toEqual([]);
      expect(state.historyErrors["test-id-1"]).toEqual({
        kind: "delete",
        message: "QuotaExceededError",
      });
      expect(state.pendingHistoryIds).toEqual([]);

      // 再試行
      await useSearchHistoryStore.getState().deleteHistory("test-id-1");

      state = useSearchHistoryStore.getState();
      expect(deleteSpy).toHaveBeenCalledTimes(2);
      expect(state.histories).toEqual([]);
      expect(state.historyErrors["test-id-1"]).toBeUndefined();
      expect(await mockDb.searchHistories.get("test-id-1")).toBeUndefined();
    });

    it("異常系: 復元に失敗しても退避を破棄せず、再試行で復元できる", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      const history = createSampleHistory({ id: "test-id-1" });
      await useSearchHistoryStore.getState().addHistory(history);
      await useSearchHistoryStore.getState().deleteHistory("test-id-1");
      vi.spyOn(mockDb.searchHistories, "add").mockRejectedValueOnce(new Error("DB closed"));

      await useSearchHistoryStore.getState().restoreHistory("test-id-1");

      let state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.deletedHistories).toEqual([history]);
      expect(state.historyErrors["test-id-1"]).toEqual({ kind: "restore", message: "DB closed" });

      await useSearchHistoryStore.getState().restoreHistory("test-id-1");

      state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([history]);
      expect(state.deletedHistories).toEqual([]);
      expect(state.historyErrors["test-id-1"]).toBeUndefined();
    });

    it("競合: 削除後に同じクエリで再検索した履歴があると、元に戻しても新しい履歴を上書きしない", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      const original = createSampleHistory({
        id: "original-id",
        createdAt: parseISO("2024-01-01T00:00:00Z"),
      });
      await useSearchHistoryStore.getState().addHistory(original);
      await useSearchHistoryStore.getState().deleteHistory("original-id");

      const researched = createSampleHistory({
        id: "researched-id",
        resultCount: 99,
        createdAt: parseISO("2024-02-01T00:00:00Z"),
      });
      await useSearchHistoryStore.getState().addHistory(researched);

      const { findRestoreConflict } = await import("./searchHistoryStore");
      expect(findRestoreConflict(useSearchHistoryStore.getState().histories, original)).toEqual(
        researched
      );

      await useSearchHistoryStore.getState().restoreHistory("original-id");

      let state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([researched]);
      expect(state.deletedHistories).toEqual([original]);
      expect(await mockDb.searchHistories.toArray()).toEqual([researched]);

      // 新しい履歴を残して復元を取りやめる
      useSearchHistoryStore.getState().discardDeletedHistory("original-id");

      state = useSearchHistoryStore.getState();
      expect(state.deletedHistories).toEqual([]);
      expect(state.histories).toEqual([researched]);
    });

    it.each([
      ["元に戻す→再検索", "restore-first"],
      ["再検索→元に戻す", "add-first"],
    ] as const)("競合: 元に戻すと同じクエリの再検索が並行しても、DBと一覧で同じクエリは1件になる（%s）", async (_label, order) => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      const original = createSampleHistory({
        id: "original-id",
        createdAt: parseISO("2024-01-01T00:00:00Z"),
      });
      await useSearchHistoryStore.getState().addHistory(original);
      await useSearchHistoryStore.getState().deleteHistory("original-id");
      const researched = createSampleHistory({
        id: "researched-id",
        createdAt: parseISO("2024-02-01T00:00:00Z"),
      });

      const { restoreHistory, addHistory } = useSearchHistoryStore.getState();
      await Promise.all(
        order === "restore-first"
          ? [restoreHistory("original-id"), addHistory(researched)]
          : [addHistory(researched), restoreHistory("original-id")]
      );

      const dbRecords = await mockDb.searchHistories.toArray();
      expect(dbRecords).toEqual([researched]);
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([researched]);
      expect(state.pendingHistoryIds).toEqual([]);
    });

    it("競合: 復元の書き込み後、一覧へ反映する前に同じクエリの再検索が反映されたら、新しい履歴だけを残す", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      const original = createSampleHistory({
        id: "original-id",
        createdAt: parseISO("2024-01-01T00:00:00Z"),
      });
      await useSearchHistoryStore.getState().addHistory(original);
      await useSearchHistoryStore.getState().deleteHistory("original-id");
      const researched = createSampleHistory({
        id: "researched-id",
        createdAt: parseISO("2024-02-01T00:00:00Z"),
      });

      // 復元のトランザクションは実行するが、完了の通知だけを遅らせる
      let releaseRestore: () => void = () => {};
      const realTransaction = mockDb.transaction.bind(mockDb) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      vi.spyOn(mockDb, "transaction").mockImplementationOnce(((...args: unknown[]) => {
        const committed = realTransaction(...args);
        return new Promise((resolve, reject) => {
          releaseRestore = () => {
            committed.then(resolve, reject);
          };
        });
      }) as typeof mockDb.transaction);

      const restoring = useSearchHistoryStore.getState().restoreHistory("original-id");
      await useSearchHistoryStore.getState().addHistory(researched);
      releaseRestore();
      await restoring;

      expect(await mockDb.searchHistories.toArray()).toEqual([researched]);
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([researched]);
      expect(state.deletedHistories).toEqual([original]);
    });

    it("競合: 一覧になく DB にだけ同じクエリの履歴がある場合は書き込まず、その履歴を一覧へ反映する", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore, findRestoreConflict } =
        await import("./searchHistoryStore");
      await initializeSearchHistoryStore(mockDb);
      const original = createSampleHistory({
        id: "original-id",
        createdAt: parseISO("2024-01-01T00:00:00Z"),
      });
      await useSearchHistoryStore.getState().addHistory(original);
      await useSearchHistoryStore.getState().deleteHistory("original-id");
      const other = createSampleHistory({
        id: "other-id",
        createdAt: parseISO("2024-02-01T00:00:00Z"),
      });
      await mockDb.searchHistories.add(other);

      await useSearchHistoryStore.getState().restoreHistory("original-id");

      expect(await mockDb.searchHistories.toArray()).toEqual([other]);
      const state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([other]);
      expect(state.deletedHistories).toEqual([original]);
      expect(findRestoreConflict(state.histories, original)).toEqual(other);
      expect(state.pendingHistoryIds).toEqual([]);
    });

    it("正常系: 全件削除すると、個別削除の退避と失敗表示も破棄する", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "a-id" }));
      await useSearchHistoryStore
        .getState()
        .addHistory(createSampleHistory({ id: "b-id", originalQuery: "深層学習" }));
      await useSearchHistoryStore.getState().deleteHistory("a-id");
      vi.spyOn(mockDb.searchHistories, "delete").mockRejectedValueOnce(new Error("失敗"));
      await useSearchHistoryStore.getState().deleteHistory("b-id");

      await useSearchHistoryStore.getState().clearAllHistories();

      const state = useSearchHistoryStore.getState();
      expect(state.histories).toEqual([]);
      expect(state.deletedHistories).toEqual([]);
      expect(state.historyErrors).toEqual({});
    });

    it("正常系: 同じ履歴の削除を連続で呼んでもDB削除は1回だけ", async () => {
      const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
        "./searchHistoryStore"
      );
      await initializeSearchHistoryStore(mockDb);
      await useSearchHistoryStore.getState().addHistory(createSampleHistory({ id: "test-id-1" }));
      const deleteSpy = vi.spyOn(mockDb.searchHistories, "delete");

      await Promise.all([
        useSearchHistoryStore.getState().deleteHistory("test-id-1"),
        useSearchHistoryStore.getState().deleteHistory("test-id-1"),
      ]);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(useSearchHistoryStore.getState().deletedHistories).toHaveLength(1);
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

      // 異なるoriginalQueryを持つ履歴を追加（同じクエリだと上書きされる仕様）
      await useSearchHistoryStore
        .getState()
        .addHistory(createSampleHistory({ id: "id-1", originalQuery: "強化学習" }));
      await useSearchHistoryStore
        .getState()
        .addHistory(createSampleHistory({ id: "id-2", originalQuery: "深層学習" }));

      // Act
      const count = useSearchHistoryStore.getState().getHistoryCount();

      // Assert
      expect(count).toBe(2);
    });
  });
});

/**
 * 別タブの変更の反映（Issue #109）
 * 別タブは同じ IndexedDB に直接書き込み、別の BroadcastChannel から変更を通知するものとして模す
 */
describe("searchHistoryStore: 別タブの変更", () => {
  let testDbCounter = 0;
  let otherTab: BroadcastChannel;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`searchHistoryStore-crossTab-test-${testDbCounter}`);
    otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
  });

  afterEach(async () => {
    otherTab.close();
    vi.restoreAllMocks();
    await mockDb.delete();
  });

  it("別タブで追加した検索履歴が反映され、このタブの削除の退避（Undo）は残る", async () => {
    const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
      "./searchHistoryStore"
    );
    await initializeSearchHistoryStore(mockDb);
    const deleted = createSampleHistory({
      originalQuery: "削除した",
      createdAt: parseISO("2024-01-01T00:00:00Z"),
    });
    await useSearchHistoryStore.getState().addHistory(deleted);
    await useSearchHistoryStore.getState().deleteHistory(deleted.id);

    const remote = createSampleHistory({
      originalQuery: "別タブ",
      createdAt: parseISO("2024-01-02T00:00:00Z"),
    });
    await mockDb.searchHistories.add(remote);
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "searchHistories",
    } satisfies DbChangeMessage);

    await vi.waitFor(() => {
      expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([remote.id]);
    });
    expect(useSearchHistoryStore.getState().deletedHistories.map((h) => h.id)).toEqual([
      deleted.id,
    ]);

    // 退避した履歴はそのまま戻せる（#80）
    await useSearchHistoryStore.getState().restoreHistory(deleted.id);
    expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([
      remote.id,
      deleted.id,
    ]);
  });

  it("このタブで検索履歴を追加すると、別タブへ通知する", async () => {
    const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
      "./searchHistoryStore"
    );
    await initializeSearchHistoryStore(mockDb);
    const received: DbChangeMessage[] = [];
    otherTab.addEventListener("message", (event: MessageEvent<DbChangeMessage>) => {
      received.push(event.data);
    });

    await useSearchHistoryStore.getState().addHistory(createSampleHistory());

    await vi.waitFor(() => {
      expect(received).toContainEqual({ dbName: mockDb.name, table: "searchHistories" });
    });
  });

  it("別タブの変更の読み直しが先に反映されても、このタブで復元した履歴は重複しない", async () => {
    const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
      "./searchHistoryStore"
    );
    await initializeSearchHistoryStore(mockDb);
    const history = createSampleHistory();
    await useSearchHistoryStore.getState().addHistory(history);
    await useSearchHistoryStore.getState().deleteHistory(history.id);

    // 復元のコミット直後、Store の更新前に、別タブの通知による読み直しを割り込ませる
    const transaction = mockDb.transaction.bind(mockDb) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(mockDb, "transaction").mockImplementationOnce((async (...args: unknown[]) => {
      const result = await transaction(...args);
      otherTab.postMessage({
        dbName: mockDb.name,
        table: "searchHistories",
      } satisfies DbChangeMessage);
      await vi.waitFor(() => {
        expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([history.id]);
      });
      return result;
    }) as never);

    await useSearchHistoryStore.getState().restoreHistory(history.id);

    const state = useSearchHistoryStore.getState();
    expect(state.histories.map((h) => h.id)).toEqual([history.id]);
    expect(state.deletedHistories).toEqual([]);
  });

  it("初期ロード中に届いた別タブの変更は、初期ロードの完了後も残る", async () => {
    const { useSearchHistoryStore, initializeSearchHistoryStore } = await import(
      "./searchHistoryStore"
    );
    useSearchHistoryStore.setState({ histories: [] });

    // 初期ロードの全件読み取りは、読み込み開始時点（空）の内容を読んだあと、反映を止めておく
    let readStarted = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const orderBy = mockDb.searchHistories.orderBy.bind(mockDb.searchHistories);
    vi.spyOn(mockDb.searchHistories, "orderBy").mockImplementationOnce(
      (index: string) =>
        ({
          reverse: () => ({
            toArray: async () => {
              const rows = await orderBy(index).reverse().toArray();
              readStarted = true;
              await gate;
              return rows;
            },
          }),
        }) as never
    );

    const initializing = initializeSearchHistoryStore(mockDb);
    await vi.waitFor(() => {
      expect(readStarted).toBe(true);
    });
    const remote = createSampleHistory({ originalQuery: "別タブ" });
    await mockDb.searchHistories.add(remote);
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "searchHistories",
    } satisfies DbChangeMessage);
    await vi.waitFor(() => {
      expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([remote.id]);
    });

    release();
    await initializing;

    expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([remote.id]);
    expect(useSearchHistoryStore.getState().isLoading).toBe(false);
  });
});
