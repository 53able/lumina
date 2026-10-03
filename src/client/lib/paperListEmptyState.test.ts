import { describe, expect, it } from "vitest";
import { getPaperListEmptyState, type PaperListEmptyStateInput } from "./paperListEmptyState";

const input = (overrides: Partial<PaperListEmptyStateInput>): PaperListEmptyStateInput => ({
  storedPaperCount: 0,
  isLoading: false,
  lastSyncError: null,
  hasSynced: false,
  ...overrides,
});

describe("getPaperListEmptyState", () => {
  it("論文が未取得で同期エラーも同期履歴もなければ未同期として、同期と設定への操作を返す", () => {
    const state = getPaperListEmptyState(input({}));
    expect(state.kind).toBe("not-synced");
    expect(state.actions).toEqual(["sync", "open-settings"]);
  });

  it("同期に成功したが論文が0件なら、同期期間・カテゴリの見直しを案内する", () => {
    const state = getPaperListEmptyState(input({ hasSynced: true }));
    expect(state.kind).toBe("synced-empty");
    expect(state.actions).toEqual(["open-settings", "sync"]);
  });

  it("論文が未取得で同期に失敗していれば、理由と再試行を返す", () => {
    const state = getPaperListEmptyState(
      input({ hasSynced: true, lastSyncError: new Error("Sync failed: 503") })
    );
    expect(state.kind).toBe("sync-failed");
    expect(state.detail).toBe("Sync failed: 503");
    expect(state.actions).toEqual(["retry-sync"]);
  });

  it("論文が保存済みなら、同期エラーが残っていても条件に一致しない0件として扱う", () => {
    const state = getPaperListEmptyState(
      input({ storedPaperCount: 10, lastSyncError: new Error("Sync failed: 503") })
    );
    expect(state.kind).toBe("no-results");
    expect(state.actions).toEqual(["clear-conditions"]);
  });

  it("論文が保存済みなら、同期中でも条件に一致しない0件として解除操作を返す", () => {
    const state = getPaperListEmptyState(input({ storedPaperCount: 10, isLoading: true }));
    expect(state.kind).toBe("no-results");
    expect(state.actions).toEqual(["clear-conditions"]);
  });

  it("論文が未取得で取得中なら操作を出さない", () => {
    const state = getPaperListEmptyState(
      input({ isLoading: true, lastSyncError: new Error("Sync failed: 503") })
    );
    expect(state.kind).toBe("loading");
    expect(state.actions).toEqual([]);
  });

  it("未同期・同期済み0件・同期失敗・条件不一致で説明がすべて異なる", () => {
    const texts = [
      getPaperListEmptyState(input({})),
      getPaperListEmptyState(input({ hasSynced: true })),
      getPaperListEmptyState(input({ lastSyncError: new Error("x") })),
      getPaperListEmptyState(input({ storedPaperCount: 1 })),
    ].map((s) => `${s.title}${s.description}`);
    expect(new Set(texts).size).toBe(4);
  });
});
