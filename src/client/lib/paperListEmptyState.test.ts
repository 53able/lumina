import { describe, expect, it } from "vitest";
import { getPaperListEmptyState } from "./paperListEmptyState";

describe("getPaperListEmptyState", () => {
  it("論文が未取得で同期エラーがなければ未同期として、同期と設定への操作を返す", () => {
    const state = getPaperListEmptyState({
      storedPaperCount: 0,
      isLoading: false,
      lastSyncError: null,
    });
    expect(state.kind).toBe("not-synced");
    expect(state.actions).toEqual(["sync", "open-settings"]);
  });

  it("論文が未取得で同期に失敗していれば、理由と再試行を返す", () => {
    const state = getPaperListEmptyState({
      storedPaperCount: 0,
      isLoading: false,
      lastSyncError: new Error("Sync failed: 503"),
    });
    expect(state.kind).toBe("sync-failed");
    expect(state.detail).toBe("Sync failed: 503");
    expect(state.actions).toEqual(["retry-sync"]);
  });

  it("論文が保存済みなら、同期エラーが残っていても条件に一致しない0件として扱う", () => {
    const state = getPaperListEmptyState({
      storedPaperCount: 10,
      isLoading: false,
      lastSyncError: new Error("Sync failed: 503"),
    });
    expect(state.kind).toBe("no-results");
    expect(state.actions).toEqual(["clear-conditions"]);
  });

  it("取得中は操作を出さない", () => {
    const state = getPaperListEmptyState({
      storedPaperCount: 0,
      isLoading: true,
      lastSyncError: new Error("Sync failed: 503"),
    });
    expect(state.kind).toBe("loading");
    expect(state.actions).toEqual([]);
  });

  it("3つの状態で説明がすべて異なる", () => {
    const texts = [
      getPaperListEmptyState({ storedPaperCount: 0, isLoading: false, lastSyncError: null }),
      getPaperListEmptyState({
        storedPaperCount: 0,
        isLoading: false,
        lastSyncError: new Error("x"),
      }),
      getPaperListEmptyState({ storedPaperCount: 1, isLoading: false, lastSyncError: null }),
    ].map((s) => `${s.title}${s.description}`);
    expect(new Set(texts).size).toBe(3);
  });
});
