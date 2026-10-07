import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserInteraction } from "../../shared/schemas/index";
import { now } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { DB_CHANGE_CHANNEL_NAME, type DbChangeMessage } from "../lib/dbChangeChannel";

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
      expect(state.interactions[0]?.paperId).toBe("2401.00001");
      expect(state.interactions[0]?.type).toBe("like");
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
      expect(dbInteractions[0]?.type).toBe("like");
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
      expect(dbInteractions[0]?.type).toBe("bookmark");
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

/**
 * 別タブの変更の反映（Issue #109）
 * 別タブは同じ IndexedDB に直接書き込み、別の BroadcastChannel から変更を通知するものとして模す
 */
describe("interactionStore: 別タブの変更", () => {
  let testDbCounter = 0;
  let otherTab: BroadcastChannel;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`interactionStore-crossTab-test-${testDbCounter}`);
    otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
  });

  afterEach(async () => {
    otherTab.close();
    vi.restoreAllMocks();
    await mockDb.delete();
  });

  it("別タブでのいいね・取り消しに追従し、通知に含まれない論文の状態は変えない", async () => {
    const { useInteractionStore, initializeInteractionStore } = await import("./interactionStore");
    await initializeInteractionStore(mockDb);
    await useInteractionStore.getState().toggleLike("2401.00001");
    await useInteractionStore.getState().toggleBookmark("2401.00002");

    // 別タブ: 2401.00001 のいいねを取り消し、ブックマークする
    await mockDb.userInteractions.where("paperId").equals("2401.00001").delete();
    await mockDb.userInteractions.add(
      createSampleInteraction({ paperId: "2401.00001", type: "bookmark" })
    );
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "userInteractions",
      paperIds: ["2401.00001"],
    } satisfies DbChangeMessage);

    await vi.waitFor(() => {
      const state = useInteractionStore.getState();
      expect(state.getLikedPaperIds().has("2401.00001")).toBe(false);
      expect(state.getBookmarkedPaperIds()).toEqual(new Set(["2401.00001", "2401.00002"]));
    });
  });

  it("このタブでいいねすると、別タブへ論文IDつきで通知する", async () => {
    const { useInteractionStore, initializeInteractionStore } = await import("./interactionStore");
    await initializeInteractionStore(mockDb);
    const received: DbChangeMessage[] = [];
    otherTab.addEventListener("message", (event: MessageEvent<DbChangeMessage>) => {
      received.push(event.data);
    });

    await useInteractionStore.getState().toggleLike("2401.00001");

    await vi.waitFor(() => {
      expect(received).toContainEqual({
        dbName: mockDb.name,
        table: "userInteractions",
        paperIds: ["2401.00001"],
      });
    });
  });

  it("別タブの変更の読み直しが先に反映されても、このタブで追加したいいねは重複しない", async () => {
    const { useInteractionStore, initializeInteractionStore } = await import("./interactionStore");
    await initializeInteractionStore(mockDb);

    // 追加の書き込み直後、Store の更新前に、別タブの通知による読み直しを割り込ませる
    const add = mockDb.userInteractions.add.bind(mockDb.userInteractions);
    vi.spyOn(mockDb.userInteractions, "add").mockImplementationOnce((async (
      interaction: UserInteraction
    ) => {
      const key = await add(interaction);
      otherTab.postMessage({
        dbName: mockDb.name,
        table: "userInteractions",
        paperIds: ["2401.00001"],
      } satisfies DbChangeMessage);
      await vi.waitFor(() => {
        expect(useInteractionStore.getState().interactions).toHaveLength(1);
      });
      return key;
    }) as never);

    await useInteractionStore.getState().toggleLike("2401.00001");

    expect(useInteractionStore.getState().interactions).toHaveLength(1);
    expect(await mockDb.userInteractions.count()).toBe(1);
  });

  it("初期ロード中に届いた別タブの変更は、初期ロードの完了後も残る", async () => {
    const { useInteractionStore, initializeInteractionStore } = await import("./interactionStore");
    useInteractionStore.setState({ interactions: [] });

    // 初期ロードの全件読み取りは、読み込み開始時点（空）の内容を読んだあと、反映を止めておく
    let readStarted = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const toArray = mockDb.userInteractions.toArray.bind(mockDb.userInteractions);
    vi.spyOn(mockDb.userInteractions, "toArray").mockImplementationOnce((async () => {
      const rows = await toArray();
      readStarted = true;
      await gate;
      return rows;
    }) as never);

    const initializing = initializeInteractionStore(mockDb);
    await vi.waitFor(() => {
      expect(readStarted).toBe(true);
    });
    await mockDb.userInteractions.add(createSampleInteraction({ paperId: "2401.00001" }));
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "userInteractions",
      paperIds: ["2401.00001"],
    } satisfies DbChangeMessage);
    await vi.waitFor(() => {
      expect(useInteractionStore.getState().getLikedPaperIds().has("2401.00001")).toBe(true);
    });

    release();
    await initializing;

    expect(useInteractionStore.getState().getLikedPaperIds().has("2401.00001")).toBe(true);
    expect(useInteractionStore.getState().isLoading).toBe(false);
  });
});
