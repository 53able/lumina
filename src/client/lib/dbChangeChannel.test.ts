import { afterEach, describe, expect, it, vi } from "vitest";
import type { LuminaDB } from "../db/db";
import {
  DB_CHANGE_CHANNEL_NAME,
  type DbChangeMessage,
  isDbChangeMessage,
  reloadUnlessChanged,
  subscribeDbChanges,
} from "./dbChangeChannel";

describe("reloadUnlessChanged", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("読み取りの前後でストアが変わらなければ、読んだ内容を反映する", async () => {
    const snapshot = {};
    const apply = vi.fn();

    await reloadUnlessChanged(
      () => snapshot,
      async () => "fresh",
      apply
    );

    expect(apply).toHaveBeenCalledExactlyOnceWith("fresh");
  });

  it("読み取りの間にストアが変わったら、読み直してから反映する", async () => {
    let snapshot = {};
    let reads = 0;
    const apply = vi.fn();

    await reloadUnlessChanged(
      () => snapshot,
      async () => {
        reads += 1;
        // 1回目の読み取りの間にだけ、自タブの操作がストアを更新したものとする
        if (reads === 1) snapshot = {};
        return `read-${reads}`;
      },
      apply
    );

    expect(reads).toBe(2);
    expect(apply).toHaveBeenCalledExactlyOnceWith("read-2");
  });

  it("規定回数続けて変わった場合は警告し、待ってからやり直して反映する（諦めない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let snapshot = {};
    let reads = 0;
    const apply = vi.fn();

    await reloadUnlessChanged(
      () => snapshot,
      async () => {
        reads += 1;
        // 最初の3回の読み取りの間はストアが変わり続ける
        if (reads <= 3) snapshot = {};
        return `read-${reads}`;
      },
      apply,
      { maxAttempts: 2, retryDelayMs: 1 }
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(reads).toBe(4);
    expect(apply).toHaveBeenCalledExactlyOnceWith("read-4");
  });
});

describe("isDbChangeMessage", () => {
  it("テーブルごとに想定した形のメッセージだけを受け付ける", () => {
    expect(isDbChangeMessage({ dbName: "db", table: "papers", paperIds: ["a"] })).toBe(true);
    expect(isDbChangeMessage({ dbName: "db", table: "paperSummaries", paperIds: null })).toBe(true);
    expect(isDbChangeMessage({ dbName: "db", table: "userInteractions", paperIds: [] })).toBe(true);
    expect(isDbChangeMessage({ dbName: "db", table: "searchHistories" })).toBe(true);

    // 論文の変更に null（全件）はない
    expect(isDbChangeMessage({ dbName: "db", table: "papers", paperIds: null })).toBe(false);
    expect(isDbChangeMessage({ dbName: "db", table: "paperSummaries", paperIds: "a" })).toBe(false);
    expect(isDbChangeMessage({ dbName: "db", table: "paperSummaries", paperIds: [1] })).toBe(false);
    expect(isDbChangeMessage({ dbName: "db", table: "paperSummaries" })).toBe(false);
    expect(isDbChangeMessage({ table: "searchHistories" })).toBe(false);
    expect(isDbChangeMessage({ dbName: "db", table: "unknown" })).toBe(false);
    expect(isDbChangeMessage(null)).toBe(false);
    expect(isDbChangeMessage("papers")).toBe(false);
  });
});

describe("subscribeDbChanges", () => {
  it("形の正しくないメッセージは無視し、正しいメッセージだけを渡す", async () => {
    const db = { name: "dbChangeChannel-test" } as LuminaDB;
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "paperSummaries", listener);
    const otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);

    try {
      otherTab.postMessage({ dbName: db.name, table: "paperSummaries", paperIds: "2401.00001" });
      otherTab.postMessage({
        dbName: db.name,
        table: "paperSummaries",
        paperIds: ["2401.00001"],
      } satisfies DbChangeMessage);

      // メッセージは送った順に届くため、正しいメッセージが届いた時点で先のメッセージも処理済み
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalled();
      });
      expect(listener).toHaveBeenCalledExactlyOnceWith({
        dbName: db.name,
        table: "paperSummaries",
        paperIds: ["2401.00001"],
      });
    } finally {
      unsubscribe();
      otherTab.close();
    }
  });
});
