/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncRateLimitError } from "../lib/api";

/**
 * syncStore テスト
 *
 * Design Docs (02-07-client-state-to-stores.md) に基づく仕様:
 * - 同期の UI/プロセス状態を保持（永続化なし）
 * - useSyncPapers が store を更新し、SyncStatusBar / PaperList / PaperExplorer が購読する
 */
describe("syncStore", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("正常系: デフォルト値で初期化される", async () => {
      const { useSyncStore } = await import("./syncStore");
      const state = useSyncStore.getState();

      expect(state.requestedRanges).toEqual([]);
      expect(state.totalResults).toBeNull();
      expect(state.isLoadingMore).toBe(false);
      expect(state.isFetching).toBe(false);
      expect(state.isSyncingAll).toBe(false);
      expect(state.syncAllProgress).toBeNull();
      expect(state.isEmbeddingBackfilling).toBe(false);
      expect(state.embeddingBackfillProgress).toBeNull();
      expect(state.lastSyncError).toBeNull();
    });
  });

  describe("同期進捗の更新", () => {
    it("正常系: requestedRanges と totalResults を更新できる", async () => {
      const { useSyncStore } = await import("./syncStore");

      useSyncStore.getState().setRequestedRanges([[0, 50]]);
      useSyncStore.getState().setTotalResults(125);

      const state = useSyncStore.getState();
      expect(state.requestedRanges).toEqual([[0, 50]]);
      expect(state.totalResults).toBe(125);
    });

    it("正常系: isLoadingMore / isFetching を更新できる", async () => {
      const { useSyncStore } = await import("./syncStore");

      useSyncStore.getState().setIsLoadingMore(true);
      useSyncStore.getState().setIsFetching(true);

      const state = useSyncStore.getState();
      expect(state.isLoadingMore).toBe(true);
      expect(state.isFetching).toBe(true);
    });

    it("正常系: isSyncingAll と syncAllProgress を更新できる", async () => {
      const { useSyncStore } = await import("./syncStore");

      useSyncStore.getState().setIsSyncingAll(true);
      useSyncStore.getState().setSyncAllProgress({ fetched: 100, total: 500 });

      const state = useSyncStore.getState();
      expect(state.isSyncingAll).toBe(true);
      expect(state.syncAllProgress).toEqual({ fetched: 100, total: 500 });
    });

    it("正常系: isEmbeddingBackfilling と embeddingBackfillProgress を更新できる", async () => {
      const { useSyncStore } = await import("./syncStore");

      useSyncStore.getState().setIsEmbeddingBackfilling(true);
      useSyncStore.getState().setEmbeddingBackfillProgress({ completed: 3, total: 10 });

      const state = useSyncStore.getState();
      expect(state.isEmbeddingBackfilling).toBe(true);
      expect(state.embeddingBackfillProgress).toEqual({ completed: 3, total: 10 });
    });
  });

  describe("エラー状態", () => {
    it("正常系: lastSyncError を設定できる", async () => {
      const { useSyncStore } = await import("./syncStore");
      const err = new Error("Network error");

      useSyncStore.getState().setLastSyncError(err);

      const state = useSyncStore.getState();
      expect(state.lastSyncError).toBe(err);
    });

    it("正常系: SyncRateLimitError を lastSyncError に設定できる", async () => {
      const { useSyncStore } = await import("./syncStore");
      const err = new SyncRateLimitError("リトライしてください", 60);

      useSyncStore.getState().setLastSyncError(err);

      const state = useSyncStore.getState();
      expect(state.lastSyncError).toBe(err);
      expect(state.lastSyncError).toBeInstanceOf(SyncRateLimitError);
    });
  });

  describe("reset", () => {
    it("正常系: reset で初期状態に戻る", async () => {
      const { useSyncStore } = await import("./syncStore");

      useSyncStore.getState().setRequestedRanges([[0, 50]]);
      useSyncStore.getState().setTotalResults(100);
      useSyncStore.getState().setIsLoadingMore(true);
      useSyncStore.getState().setLastSyncError(new Error("err"));
      useSyncStore.getState().reset();

      const state = useSyncStore.getState();
      expect(state.requestedRanges).toEqual([]);
      expect(state.totalResults).toBeNull();
      expect(state.isLoadingMore).toBe(false);
      expect(state.lastSyncError).toBeNull();
    });
  });
});
