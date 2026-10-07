/**
 * @vitest-environment jsdom
 *
 * タブの復帰時の読み直し（Issue #127）
 * bfcache・凍結中のタブには別タブの変更通知が届かないことがあるため、
 * bfcache からの復帰（pageshow の persisted）・前面への復帰（visibilitychange）で
 * 要約・いいね/ブックマーク・検索履歴を IndexedDB から読み直す。
 * 別タブは同じ IndexedDB に直接書き込み、通知は届かなかったものとして模す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary, SearchHistory, UserInteraction } from "../../shared/schemas/index";
import { now } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { subscribeDbChanges } from "../lib/dbChangeChannel";
import { initializeInteractionStore, useInteractionStore } from "./interactionStore";
import { initializeSearchHistoryStore, useSearchHistoryStore } from "./searchHistoryStore";
import { initializeSummaryStore, useSummaryStore } from "./summaryStore";

const summary: PaperSummary = {
  paperId: "2401.00001",
  summary: "別タブで生成した要約",
  keyPoints: ["要点"],
  language: "ja",
  createdAt: now(),
};

const interaction: UserInteraction = {
  id: crypto.randomUUID(),
  paperId: "2401.00001",
  type: "like",
  createdAt: now(),
};

const history: SearchHistory = {
  id: crypto.randomUUID(),
  originalQuery: "別タブの検索",
  expandedQuery: {
    original: "別タブの検索",
    english: "search",
    synonyms: [],
    searchText: "search",
  },
  queryEmbedding: [0.1],
  resultCount: 1,
  createdAt: now(),
};

/** 別タブの書き込み（このタブには通知が届かなかったものとする） */
const writeInOtherTab = async (db: LuminaDB) => {
  await db.paperSummaries.add(summary);
  await db.userInteractions.add(interaction);
  await db.searchHistories.add(history);
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
};

const expectRemoteChangesShown = async () => {
  await vi.waitFor(() => {
    expect(useSummaryStore.getState().summaries.map((s) => s.summary)).toEqual([summary.summary]);
    expect(useInteractionStore.getState().interactions.map((i) => i.id)).toEqual([interaction.id]);
    expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([history.id]);
  });
};

describe("subscribeDbChanges の復帰時の呼び出し", () => {
  const db = { name: "resumeReload-subscribe-test" } as LuminaDB;

  afterEach(() => {
    setVisibility("visible");
  });

  it("論文は件数が多いため、復帰しても全件を読み直さない（listener を呼ばない）", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "papers", listener);
    try {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("読み直しの間に復帰が続いても積み上げず、完了後に1回だけ読み直す", async () => {
    const reads: Array<() => void> = [];
    const listener = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          reads.push(resolve);
        })
    );
    const unsubscribe = subscribeDbChanges(db, "paperSummaries", listener);
    try {
      for (let i = 0; i < 5; i += 1) {
        document.dispatchEvent(new Event("visibilitychange"));
      }
      expect(listener).toHaveBeenCalledExactlyOnceWith({ table: "paperSummaries", paperIds: null });

      reads[0]?.();
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(2);
      });
      reads[1]?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("購読を解除したら、復帰しても呼ばない", async () => {
    const listener = vi.fn();
    subscribeDbChanges(db, "searchHistories", listener)();

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listener).not.toHaveBeenCalled();
  });
});

// ストアの購読はファイルの最後まで残るため、ストアのテストは最後に置く
describe("タブの復帰時の読み直し", () => {
  let db: LuminaDB;
  let counter = 0;

  beforeEach(async () => {
    counter += 1;
    db = createLuminaDb(`resumeReload-test-${counter}`);
    setVisibility("visible");
    await initializeSummaryStore(db);
    await initializeInteractionStore(db);
    await initializeSearchHistoryStore(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
  });

  it("bfcache から復帰したら（pageshow の persisted）、離れている間の別タブの変更を表示する", async () => {
    await writeInOtherTab(db);

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

    await expectRemoteChangesShown();
  });

  it("前面に戻ったら（visibilitychange で visible）、離れている間の別タブの変更を表示する", async () => {
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await writeInOtherTab(db);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    await expectRemoteChangesShown();
  });

  it("通常の読み込みの pageshow・背面に回ったときは読み直さない", async () => {
    const toCollection = vi.spyOn(db.paperSummaries, "toCollection");
    const toArray = vi.spyOn(db.userInteractions, "toArray");

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    // 読み直しが始まるなら、ここまでに読み取りが呼ばれている
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toCollection).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
  });
});
