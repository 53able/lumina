/**
 * @vitest-environment jsdom
 *
 * タブの復帰時の読み直し（Issue #127）
 * bfcache・凍結中のタブには別タブの変更通知が届かないことがあるため、
 * bfcache からの復帰（pageshow の persisted）・前面への復帰（visibilitychange）で
 * 要約・いいね/ブックマーク・検索履歴を IndexedDB から読み直す。
 * 前面への復帰は背面にいた時間がしきい値以上のときだけ、短時間に続く復帰は1回とみなす。
 * 別タブは同じ IndexedDB に直接書き込み、通知は届かなかったものとして模す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary, SearchHistory, UserInteraction } from "../../shared/schemas/index";
import { now } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "../db/db";
import {
  RESUME_DEDUPE_MS,
  RESUME_HIDDEN_THRESHOLD_MS,
  subscribeDbChanges,
} from "../lib/dbChangeChannel";
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

/** 経過時間（Date.now に足す） */
let elapsed = 0;
const realNow = Date.now.bind(Date);
/**
 * 時計を止め、elapsed だけで進める
 * （実時間を足すと、背面に回ってから戻るまでの実行時間でしきい値を越え、負荷次第で結果が変わるため）
 */
const mockClock = () => {
  const base = realNow();
  vi.spyOn(Date, "now").mockImplementation(() => base + elapsed);
};

/** 背面に回り、ms だけ経ってから前面に戻る */
const hideFor = (ms: number) => {
  setVisibility("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  elapsed += ms;
  setVisibility("visible");
  document.dispatchEvent(new Event("visibilitychange"));
};

const showFromBfcache = () => {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
};

/** 読み直しが始まるなら呼ばれているはずの時間を待つ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const expectRemoteChangesShown = async () => {
  await vi.waitFor(() => {
    expect(useSummaryStore.getState().summaries.map((s) => s.summary)).toEqual([summary.summary]);
    expect(useInteractionStore.getState().interactions.map((i) => i.id)).toEqual([interaction.id]);
    expect(useSearchHistoryStore.getState().histories.map((h) => h.id)).toEqual([history.id]);
  });
};

describe("subscribeDbChanges の復帰時の呼び出し", () => {
  const db = { name: "resumeReload-subscribe-test" } as LuminaDB;

  beforeEach(() => {
    mockClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setVisibility("visible");
  });

  it("論文は件数が多いため、復帰しても全件を読み直さない（listener を呼ばない）", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "papers", listener);
    try {
      showFromBfcache();
      hideFor(RESUME_HIDDEN_THRESHOLD_MS);
      await settle();

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("前面への復帰は、背面にいた時間がしきい値以上のときだけ読み直す", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "userInteractions", listener);
    try {
      hideFor(RESUME_HIDDEN_THRESHOLD_MS - 1);
      await settle();
      expect(listener).not.toHaveBeenCalled();

      hideFor(RESUME_HIDDEN_THRESHOLD_MS);
      await settle();
      expect(listener).toHaveBeenCalledExactlyOnceWith({
        table: "userInteractions",
        paperIds: null,
      });
    } finally {
      unsubscribe();
    }
  });

  it("bfcache から復帰したときは、背面にいた時間によらず読み直す", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "searchHistories", listener);
    try {
      showFromBfcache();
      await settle();
      expect(listener).toHaveBeenCalledExactlyOnceWith({ table: "searchHistories" });
    } finally {
      unsubscribe();
    }
  });

  it("bfcache 復帰で pageshow と visibilitychange が続けて来ても、読み直しは1回にする", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDbChanges(db, "paperSummaries", listener);
    try {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      elapsed += RESUME_HIDDEN_THRESHOLD_MS;
      showFromBfcache();
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      expect(listener).toHaveBeenCalledTimes(1);

      // 短時間が過ぎた後の復帰は読み直す
      elapsed += RESUME_DEDUPE_MS;
      showFromBfcache();
      await settle();
      expect(listener).toHaveBeenCalledTimes(2);
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
      // 読み直しが長引いている間に、短時間の間引きを超えて復帰が続く
      for (let i = 0; i < 5; i += 1) {
        elapsed += RESUME_DEDUPE_MS;
        showFromBfcache();
      }
      expect(listener).toHaveBeenCalledExactlyOnceWith({ table: "paperSummaries", paperIds: null });

      reads[0]?.();
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledTimes(2);
      });
      reads[1]?.();
      await settle();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("購読を解除したら、復帰しても呼ばない", async () => {
    const listener = vi.fn();
    subscribeDbChanges(db, "searchHistories", listener)();

    showFromBfcache();
    hideFor(RESUME_HIDDEN_THRESHOLD_MS);
    await settle();

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
    mockClock();
    setVisibility("visible");
    await initializeSummaryStore(db);
    await initializeInteractionStore(db);
    await initializeSearchHistoryStore(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setVisibility("visible");
    await db.delete();
  });

  it("bfcache から復帰したら（pageshow の persisted）、離れている間の別タブの変更を表示する", async () => {
    await writeInOtherTab(db);

    showFromBfcache();

    await expectRemoteChangesShown();
  });

  it("しばらく背面にいてから前面に戻ったら、離れている間の別タブの変更を表示する", async () => {
    await writeInOtherTab(db);

    hideFor(RESUME_HIDDEN_THRESHOLD_MS);

    await expectRemoteChangesShown();
  });

  it("通常の読み込みの pageshow・背面に回ったとき・短い切り替えでは読み直さない", async () => {
    const summaryRead = vi.spyOn(db.paperSummaries, "toCollection");
    const interactionRead = vi.spyOn(db.userInteractions, "toArray");
    const historyRead = vi.spyOn(db.searchHistories, "orderBy");

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(summaryRead).not.toHaveBeenCalled();
    expect(interactionRead).not.toHaveBeenCalled();
    expect(historyRead).not.toHaveBeenCalled();
  });

  it("読み直した内容が変わっていなければ、ストアを更新しない（再描画させない）", async () => {
    await useSummaryStore.getState().addSummary(summary);
    await useInteractionStore.getState().toggleLike(interaction.paperId);
    await useSearchHistoryStore.getState().addHistory(history);
    const before = {
      summaries: useSummaryStore.getState().summaries,
      interactions: useInteractionStore.getState().interactions,
      histories: useSearchHistoryStore.getState().histories,
    };
    const historyRead = vi.spyOn(db.searchHistories, "orderBy");

    showFromBfcache();
    await vi.waitFor(() => {
      expect(historyRead).toHaveBeenCalled();
    });
    await settle();

    expect(useSummaryStore.getState().summaries).toBe(before.summaries);
    expect(useInteractionStore.getState().interactions).toBe(before.interactions);
    expect(useSearchHistoryStore.getState().histories).toBe(before.histories);
  });
});
