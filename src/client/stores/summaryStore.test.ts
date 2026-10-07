import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperSummary } from "../../shared/schemas/index";
import { now } from "../../shared/utils/dateTime";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { DB_CHANGE_CHANNEL_NAME, type DbChangeMessage } from "../lib/dbChangeChannel";
import type { SummaryVersion } from "./summaryStore";

/**
 * summaryStore テスト
 *
 * Design Docsに基づく仕様:
 * - 論文要約の管理（CRUD操作）
 * - IndexedDBへの永続化
 * - 言語別の要約取得
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプル要約データ
const createSampleSummary = (overrides: Partial<PaperSummary> = {}): PaperSummary => ({
  paperId: "2401.00001",
  summary: "この論文は強化学習の新しいアプローチを提案しています。",
  keyPoints: ["新しいアルゴリズム", "高い性能", "実用的な応用"],
  language: "ja",
  createdAt: now(),
  ...overrides,
});

describe("summaryStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`summaryStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const state = useSummaryStore.getState();

      expect(state.summaries).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingSummary = createSampleSummary();
      await mockDb.paperSummaries.add(existingSummary);

      // Act
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const state = useSummaryStore.getState();

      // Assert
      expect(state.summaries).toHaveLength(1);
      expect(state.summaries[0].paperId).toBe("2401.00001");
    });
  });

  describe("要約の追加", () => {
    it("正常系: 要約を追加できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summary = createSampleSummary();

      // Act
      await useSummaryStore.getState().addSummary(summary);

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(1);
      expect(state.summaries[0].summary).toContain("強化学習");

      // Assert - IndexedDB永続化
      const dbSummaries = await mockDb.paperSummaries
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbSummaries).toHaveLength(1);
    });

    it("正常系: 同じ論文の異なる言語の要約を追加できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summaryJa = createSampleSummary({ language: "ja" });
      const summaryEn = createSampleSummary({
        language: "en",
        summary: "This paper proposes a new approach to reinforcement learning.",
      });

      // Act
      await useSummaryStore.getState().addSummary(summaryJa);
      await useSummaryStore.getState().addSummary(summaryEn);

      // Assert
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(2);
    });

    it("正常系: 同じ論文・言語の要約を再生成すると旧版を残し、最新の版を返す", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "旧版" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "新版" }));

      const state = useSummaryStore.getState();
      expect(state.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("新版");
      const dbSummaries = await mockDb.paperSummaries
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbSummaries.map((s) => s.summary)).toEqual(["旧版", "新版"]);
    });

    it("正常系: 既存の重複レコードは初期化後に最後に保存した版を返す", async () => {
      await mockDb.paperSummaries.add(createSampleSummary({ summary: "旧版" }));
      await mockDb.paperSummaries.add(
        createSampleSummary({ summary: "旧版", explanation: "後から生成した説明文" })
      );
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      expect(
        useSummaryStore.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.explanation
      ).toBe("後から生成した説明文");
    });
  });

  describe("要約の部分更新", () => {
    it("正常系: 説明文だけを最新の版へ反映し、要約と旧版は変更しない", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);
      await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "旧版" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "新版" }));

      await useSummaryStore.getState().updateSummary("2401.00001", "ja", {
        explanation: "説明文",
        targetAudience: "研究者",
        whyRead: "理由",
      });

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(2);
      expect(state.getSummaryByPaperIdAndLanguage("2401.00001", "ja")).toMatchObject({
        summary: "新版",
        explanation: "説明文",
        targetAudience: "研究者",
        whyRead: "理由",
      });
      expect(state.summaries[0].explanation).toBeUndefined();

      // Assert - IndexedDB（物理削除しない）
      const dbSummaries = await mockDb.paperSummaries
        .where("paperId")
        .equals("2401.00001")
        .toArray();
      expect(dbSummaries).toHaveLength(2);
      expect(dbSummaries[0].summary).toBe("旧版");
      expect(dbSummaries[0].explanation).toBeUndefined();
      expect(dbSummaries[1]).toMatchObject({ summary: "新版", explanation: "説明文" });
    });

    it("正常系: 説明文だけを更新しても、版のキーポイントの根拠は残る", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);
      const keyPointEvidence = [[{ index: 0, text: "First." }], [], []];
      await useSummaryStore.getState().addSummary(createSampleSummary({ keyPointEvidence }));

      await useSummaryStore.getState().updateSummary("2401.00001", "ja", { whyRead: "理由" });

      expect(
        useSummaryStore.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")
      ).toMatchObject({ whyRead: "理由", keyPointEvidence });
      const [saved] = await mockDb.paperSummaries.where("paperId").equals("2401.00001").toArray();
      expect(saved.keyPointEvidence).toEqual(keyPointEvidence);
    });

    it("異常系: 要約がない場合は失敗する", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await expect(
        useSummaryStore.getState().updateSummary("2401.00001", "ja", { explanation: "説明文" })
      ).rejects.toThrow("Summary not found");
    });
  });

  describe("版の採用・破棄", () => {
    /** 同じ論文・言語の版を古い順に追加し、Store の版を返す */
    const addVersions = async (texts: string[]) => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);
      for (const text of texts) {
        await useSummaryStore.getState().addSummary(createSampleSummary({ summary: text }));
      }
      return useSummaryStore;
    };

    /** IndexedDB から読み直す（再読込の代わり） */
    const reload = async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      useSummaryStore.setState({ summaries: [] });
      await initializeSummaryStore(mockDb);
      return useSummaryStore.getState();
    };

    it("正常系: 再生成した版を採用版にし、旧版は採用を外して残す", async () => {
      await addVersions(["旧版", "新版"]);

      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries.map((s) => [s.summary, s.adopted])).toEqual([
        ["旧版", false],
        ["新版", true],
      ]);
      expect((await reload()).getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
        "新版"
      );
    });

    it("正常系: 旧版を採用すると表示版が切り替わり、再読込後も維持される", async () => {
      const store = await addVersions(["旧版", "新版"]);
      const [oldVersion] = store.getState().summaries;

      await store.getState().adoptSummary(oldVersion.id);

      expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
        "旧版"
      );
      const reloaded = await reload();
      expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("旧版");
      expect(reloaded.summaries).toHaveLength(2);
    });

    it("正常系: 採用版でない版を破棄しても採用版は変わらない", async () => {
      const store = await addVersions(["第1版", "第2版", "第3版"]);
      const [first] = store.getState().summaries;

      await store.getState().discardSummary(first.id);

      const reloaded = await reload();
      expect(reloaded.summaries.map((s) => s.summary)).toEqual(["第2版", "第3版"]);
      expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("第3版");
    });

    it("正常系: 採用版を破棄すると、残りの版のうち最新の版を採用し、再読込後も維持される", async () => {
      const store = await addVersions(["第1版", "第2版", "第3版"]);
      const [first, second, third] = store.getState().summaries;
      // 第1版 → 第3版の順に採用してから第3版を破棄する。
      // 直前に採用していた第1版ではなく、残りの版のうち最新の第2版が採用版になる
      await store.getState().adoptSummary(first.id);
      await store.getState().adoptSummary(third.id);

      await store.getState().discardSummary(third.id);

      expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.id).toBe(
        second.id
      );
      const reloaded = await reload();
      expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("第2版");
      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries.filter((s) => s.adopted).map((s) => s.summary)).toEqual(["第2版"]);
    });

    it("正常系: 最後の版を破棄すると要約がなくなる", async () => {
      const store = await addVersions(["唯一の版"]);
      const [only] = store.getState().summaries;

      await store.getState().discardSummary(only.id);

      expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")).toBeUndefined();
      expect(await mockDb.paperSummaries.count()).toBe(0);
    });

    it("正常系: 採用指定のない既存データは最新の版を採用版とみなし、旧版を採用できる", async () => {
      // 採用指定（adopted）を持たない、本変更前に保存された版
      await mockDb.paperSummaries.add(createSampleSummary({ summary: "既存の旧版" }));
      await mockDb.paperSummaries.add(createSampleSummary({ summary: "既存の新版" }));

      const loaded = await reload();
      expect(loaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("既存の新版");

      await loaded.adoptSummary(loaded.summaries[0].id);
      expect((await reload()).getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
        "既存の旧版"
      );
    });

    it("正常系: 説明文のみの更新は採用版に入り、他の版は変更しない", async () => {
      const store = await addVersions(["旧版", "新版"]);
      await store.getState().adoptSummary(store.getState().summaries[0].id);

      await store.getState().updateSummary("2401.00001", "ja", { whyRead: "理由" });

      const reloaded = await reload();
      expect(reloaded.summaries.map((s) => [s.summary, s.whyRead])).toEqual([
        ["旧版", "理由"],
        ["新版", undefined],
      ]);
    });

    it("正常系: 他の論文・言語の採用版には影響しない", async () => {
      const store = await addVersions(["ja旧版", "ja新版"]);
      await store.getState().addSummary(createSampleSummary({ language: "en", summary: "en版" }));
      await store
        .getState()
        .addSummary(createSampleSummary({ paperId: "other", summary: "別論文" }));

      await store.getState().adoptSummary(store.getState().summaries[0].id);

      const reloaded = await reload();
      expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "en")?.summary).toBe("en版");
      expect(reloaded.getSummaryByPaperIdAndLanguage("other", "ja")?.summary).toBe("別論文");
    });

    describe("並行操作", () => {
      /** Store の版（id・本文・採用指定）。DB の再読込結果と比べる */
      const snapshot = (summaries: SummaryVersion[]) =>
        summaries
          .map((s) => [s.id, s.paperId, s.language, s.summary, s.adopted === true] as const)
          .sort((a, b) => a[0] - b[0]);

      /** Store が DB と一致し、論文・言語ごとの採用指定が1件以下であることを確認する */
      const expectStoreMatchesDb = async (store: Awaited<ReturnType<typeof addVersions>>) => {
        const current = store.getState().summaries;
        const reloaded = await reload();
        expect(snapshot(current)).toEqual(snapshot(reloaded.summaries));
        const adoptedCount = new Map<string, number>();
        for (const s of reloaded.summaries) {
          if (!s.adopted) continue;
          const key = `${s.paperId}:${s.language}`;
          adoptedCount.set(key, (adoptedCount.get(key) ?? 0) + 1);
        }
        expect([...adoptedCount.values()].every((count) => count === 1)).toBe(true);
      };

      it("正常系: 論文1の版の破棄と論文2の追加を同時に行っても、追加した版が Store に残る", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [, second] = store.getState().summaries;

        await Promise.all([
          store.getState().discardSummary(second.id),
          store.getState().addSummary(createSampleSummary({ paperId: "paper2", summary: "論文2" })),
        ]);

        expect(store.getState().getSummaryByPaperIdAndLanguage("paper2", "ja")?.summary).toBe(
          "論文2"
        );
        expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
          "第1版"
        );
        await expectStoreMatchesDb(store);
      });

      it("正常系: 論文2の追加の書き込み中に論文1の版を破棄しても、追加した版が Store に残る", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [, second] = store.getState().summaries;

        // 追加を先に始め、その書き込み中に破棄を始める（破棄は追加の完了後に終わる）
        await Promise.all([
          store.getState().addSummary(createSampleSummary({ paperId: "paper2", summary: "論文2" })),
          store.getState().discardSummary(second.id),
        ]);

        expect(store.getState().getSummaryByPaperIdAndLanguage("paper2", "ja")?.summary).toBe(
          "論文2"
        );
        expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
          "第1版"
        );
        await expectStoreMatchesDb(store);
      });

      it("正常系: 英語版の採用と日本語版の追加を同時に行っても、両方が反映される", async () => {
        const store = await addVersions(["ja第1版"]);
        await store
          .getState()
          .addSummary(createSampleSummary({ language: "en", summary: "en第1版" }));
        await store
          .getState()
          .addSummary(createSampleSummary({ language: "en", summary: "en第2版" }));
        const enFirst = store.getState().summaries.find((s) => s.summary === "en第1版");
        if (!enFirst) throw new Error("en第1版がない");

        // 追加の書き込み中に採用を始める（採用は追加の完了後に終わる）
        await Promise.all([
          store.getState().addSummary(createSampleSummary({ summary: "ja第2版" })),
          store.getState().adoptSummary(enFirst.id),
        ]);

        expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "en")?.summary).toBe(
          "en第1版"
        );
        expect(store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe(
          "ja第2版"
        );
        await expectStoreMatchesDb(store);
      });

      it("正常系: 同じ論文・言語で採用と追加を同時に行っても、採用指定は1件だけになる", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [first] = store.getState().summaries;

        // 追加の書き込み中に採用を始める（採用は追加の完了後に終わり、採用した第1版が採用版になる）
        await Promise.all([
          store.getState().addSummary(createSampleSummary({ summary: "第3版" })),
          store.getState().adoptSummary(first.id),
        ]);

        expect(store.getState().summaries.map((s) => s.summary)).toEqual([
          "第1版",
          "第2版",
          "第3版",
        ]);
        await expectStoreMatchesDb(store);
      });
    });

    describe("利用者の訂正", () => {
      /** 版ごとの [本文, 訂正文] を返す（DB の再読込結果） */
      const corrections = (summaries: SummaryVersion[]) =>
        summaries.map((s) => [s.summary, s.userCorrection?.text] as const);

      it("正常系: 訂正文を保存してもAI生成文は変わらず、再読込後も維持される", async () => {
        const store = await addVersions(["AIの要約"]);
        const [only] = store.getState().summaries;

        await store.getState().saveCorrection(only.id, "  手法名の誤りを訂正  ");

        const current = store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja");
        expect(current?.summary).toBe("AIの要約");
        expect(current?.userCorrection?.text).toBe("手法名の誤りを訂正");
        const reloaded = await reload();
        const adopted = reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja");
        expect(adopted?.summary).toBe("AIの要約");
        expect(adopted?.userCorrection?.text).toBe("手法名の誤りを訂正");
        expect(adopted?.userCorrection?.updatedAt).toBeInstanceOf(Date);
      });

      it("正常系: 空白だけで保存すると訂正を削除する", async () => {
        const store = await addVersions(["AIの要約"]);
        const [only] = store.getState().summaries;
        await store.getState().saveCorrection(only.id, "訂正");

        await store.getState().saveCorrection(only.id, "   ");

        expect(store.getState().summaries[0]).not.toHaveProperty("userCorrection");
        const [dbSummary] = await mockDb.paperSummaries.toArray();
        expect(dbSummary).not.toHaveProperty("userCorrection");
      });

      it("正常系: 再生成した新しい版には引き継がず、旧版に残る（旧版を採用し直すと表示される）", async () => {
        const store = await addVersions(["第1版"]);
        const [first] = store.getState().summaries;
        await store.getState().saveCorrection(first.id, "第1版への訂正");

        await store.getState().addSummary(createSampleSummary({ summary: "第2版" }));

        expect(
          store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.userCorrection
        ).toBeUndefined();
        expect(corrections((await reload()).summaries)).toEqual([
          ["第1版", "第1版への訂正"],
          ["第2版", undefined],
        ]);

        await store.getState().adoptSummary(first.id);
        expect(
          store.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.userCorrection?.text
        ).toBe("第1版への訂正");
      });

      it("正常系: 説明文のみの更新では訂正文を消さない", async () => {
        const store = await addVersions(["AIの要約"]);
        await store.getState().saveCorrection(store.getState().summaries[0].id, "訂正");

        await store.getState().updateSummary("2401.00001", "ja", { whyRead: "理由" });

        const adopted = (await reload()).getSummaryByPaperIdAndLanguage("2401.00001", "ja");
        expect([adopted?.whyRead, adopted?.userCorrection?.text]).toEqual(["理由", "訂正"]);
      });

      it("正常系: 版を破棄すると訂正文も消える", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [, second] = store.getState().summaries;
        await store.getState().saveCorrection(second.id, "第2版への訂正");

        await store.getState().discardSummary(second.id);

        expect(corrections((await reload()).summaries)).toEqual([["第1版", undefined]]);
      });

      it("異常系: 上限を超える訂正文は保存しない", async () => {
        const { SUMMARY_CORRECTION_MAX_LENGTH } = await import("../../shared/schemas/index");
        const store = await addVersions(["AIの要約"]);
        const [only] = store.getState().summaries;

        await expect(
          store.getState().saveCorrection(only.id, "あ".repeat(SUMMARY_CORRECTION_MAX_LENGTH + 1))
        ).rejects.toThrow();

        expect(corrections((await reload()).summaries)).toEqual([["AIの要約", undefined]]);
      });

      it("異常系: 破棄済みの版には保存しない（別のタブで破棄された場合を含む）", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [first] = store.getState().summaries;
        // 別のタブでの破棄（Store の控えには残る）
        await mockDb.paperSummaries.delete(first.id as unknown as string);

        await expect(store.getState().saveCorrection(first.id, "訂正")).rejects.toThrow(
          "Summary not found"
        );
        expect(await mockDb.paperSummaries.count()).toBe(1);
      });

      it("正常系: 保存中に別の版を採用しても、訂正は保存を始めた版に付き、採用版は変わる", async () => {
        const store = await addVersions(["第1版", "第2版"]);
        const [first, second] = store.getState().summaries;

        // 第2版（採用版）への訂正の保存中に、第1版を採用する
        await Promise.all([
          store.getState().saveCorrection(second.id, "第2版への訂正"),
          store.getState().adoptSummary(first.id),
        ]);

        const current = store.getState();
        expect(current.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.id).toBe(first.id);
        expect(corrections(current.summaries)).toEqual([
          ["第1版", undefined],
          ["第2版", "第2版への訂正"],
        ]);
        const reloaded = await reload();
        expect(corrections(reloaded.summaries)).toEqual(corrections(current.summaries));
        expect(reloaded.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.id).toBe(first.id);
      });
    });

    it("正常系: getAdoptedSummaries は論文ごとの採用版を返す（一覧の whyRead 用）", async () => {
      const { getAdoptedSummaries } = await import("./summaryStore");
      const base = { keyPoints: [], createdAt: now() };
      const adopted = getAdoptedSummaries(
        [
          { ...base, id: 1, paperId: "a", language: "ja", summary: "a1", adopted: true },
          { ...base, id: 2, paperId: "a", language: "ja", summary: "a2", adopted: false },
          { ...base, id: 3, paperId: "b", language: "ja", summary: "b1" },
          { ...base, id: 4, paperId: "b", language: "ja", summary: "b2" },
          { ...base, id: 5, paperId: "a", language: "en", summary: "a-en" },
        ],
        "ja"
      );

      expect([...adopted].map(([paperId, s]) => [paperId, s.summary])).toEqual([
        ["a", "a1"],
        ["b", "b2"],
      ]);
    });
  });

  describe("要約の取得", () => {
    it("正常系: 論文IDと言語で要約を取得できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      const summaryJa = createSampleSummary({ language: "ja" });
      const summaryEn = createSampleSummary({
        language: "en",
        summary: "English summary",
      });

      await useSummaryStore.getState().addSummary(summaryJa);
      await useSummaryStore.getState().addSummary(summaryEn);

      // Act
      const retrievedJa = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("2401.00001", "ja");
      const retrievedEn = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("2401.00001", "en");

      // Assert
      expect(retrievedJa).toBeDefined();
      expect(retrievedJa?.summary).toContain("強化学習");
      expect(retrievedEn).toBeDefined();
      expect(retrievedEn?.summary).toBe("English summary");
    });

    it("正常系: 存在しない論文IDはundefinedを返す", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      // Act
      const retrieved = useSummaryStore
        .getState()
        .getSummaryByPaperIdAndLanguage("nonexistent", "ja");

      // Assert
      expect(retrieved).toBeUndefined();
    });

    it("正常系: 論文IDで全言語の要約を取得できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "ja" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "en" }));

      // Act
      const summaries = useSummaryStore.getState().getSummariesByPaperId("2401.00001");

      // Assert
      expect(summaries).toHaveLength(2);
    });
  });

  describe("要約の削除", () => {
    it("正常系: 論文IDで要約を削除できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "ja" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ language: "en" }));

      // Act
      await useSummaryStore.getState().deleteSummariesByPaperId("2401.00001");

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(0);

      // Assert - IndexedDB
      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries).toHaveLength(0);
    });
  });

  describe("全要約のクリア", () => {
    it("正常系: 全要約を削除できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore.getState().addSummary(createSampleSummary({ paperId: "paper1" }));
      await useSummaryStore.getState().addSummary(createSampleSummary({ paperId: "paper2" }));

      // Act
      await useSummaryStore.getState().clearAllSummaries();

      // Assert - Store
      const state = useSummaryStore.getState();
      expect(state.summaries).toHaveLength(0);

      // Assert - IndexedDB
      const dbSummaries = await mockDb.paperSummaries.toArray();
      expect(dbSummaries).toHaveLength(0);
    });
  });

  describe("要約の存在確認", () => {
    it("正常系: 要約が存在するか確認できる", async () => {
      const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
      await initializeSummaryStore(mockDb);

      await useSummaryStore
        .getState()
        .addSummary(createSampleSummary({ paperId: "2401.00001", language: "ja" }));

      // Act
      const hasJa = useSummaryStore.getState().hasSummary("2401.00001", "ja");
      const hasEn = useSummaryStore.getState().hasSummary("2401.00001", "en");
      const hasOther = useSummaryStore.getState().hasSummary("other", "ja");

      // Assert
      expect(hasJa).toBe(true);
      expect(hasEn).toBe(false);
      expect(hasOther).toBe(false);
    });
  });
});

/**
 * 別タブの変更の反映（Issue #109）
 * 別タブは同じ IndexedDB に直接書き込み、別の BroadcastChannel から変更を通知するものとして模す
 */
describe("summaryStore: 別タブの変更", () => {
  let testDbCounter = 0;
  let otherTab: BroadcastChannel;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`summaryStore-crossTab-test-${testDbCounter}`);
    otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
  });

  afterEach(async () => {
    otherTab.close();
    vi.restoreAllMocks();
    await mockDb.delete();
  });

  const notifyFromOtherTab = (paperIds: string[] | null) => {
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "paperSummaries",
      paperIds,
    } satisfies DbChangeMessage);
  };

  it("別タブで生成した要約が、このタブで生成済みとして表示される（重複生成しない）", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);
    expect(useSummaryStore.getState().hasSummary("2401.00001", "ja")).toBe(false);

    await mockDb.paperSummaries.add(
      createSampleSummary({ summary: "別タブの要約", adopted: true })
    );
    notifyFromOtherTab(["2401.00001"]);

    await vi.waitFor(() => {
      expect(
        useSummaryStore.getState().getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary
      ).toBe("別タブの要約");
    });
  });

  it("別タブでの版の採用・破棄に追従し、通知に含まれない論文の要約は変えない", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);
    await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "版1" }));
    await useSummaryStore.getState().addSummary(createSampleSummary({ summary: "版2" }));
    await useSummaryStore
      .getState()
      .addSummary(createSampleSummary({ paperId: "2401.00002", summary: "別論文" }));
    const [v1, v2] = useSummaryStore.getState().summaries;
    if (!v1 || !v2) throw new Error("versions not found");

    // 別タブ: 版1を採用し、版2（採用版）を破棄する
    await mockDb.paperSummaries.where(":id").equals(v1.id).modify({ adopted: true });
    await mockDb.paperSummaries.where(":id").equals(v2.id).delete();
    notifyFromOtherTab(["2401.00001"]);

    await vi.waitFor(() => {
      const state = useSummaryStore.getState();
      expect(state.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.id).toBe(v1.id);
      expect(state.summaries.filter((s) => s.paperId === "2401.00001")).toHaveLength(1);
    });
    expect(
      useSummaryStore.getState().getSummaryByPaperIdAndLanguage("2401.00002", "ja")?.summary
    ).toBe("別論文");
  });

  it("別タブで全要約を削除すると、このタブの要約も消える", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);
    await useSummaryStore.getState().addSummary(createSampleSummary());

    await mockDb.paperSummaries.clear();
    notifyFromOtherTab(null);

    await vi.waitFor(() => {
      expect(useSummaryStore.getState().summaries).toEqual([]);
    });
  });

  it("別の DB への変更通知では読み直さない", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);
    await mockDb.paperSummaries.add(createSampleSummary());
    otherTab.postMessage({
      dbName: "other-db",
      table: "paperSummaries",
      paperIds: ["2401.00001"],
    } satisfies DbChangeMessage);
    // 対照: 同じ DB への通知（届いた順に処理されるため、これが反映された時点で先の通知も処理済み）
    await mockDb.paperSummaries.add(createSampleSummary({ paperId: "2401.00002" }));
    notifyFromOtherTab(["2401.00002"]);

    await vi.waitFor(() => {
      expect(useSummaryStore.getState().hasSummary("2401.00002", "ja")).toBe(true);
    });
    expect(useSummaryStore.getState().hasSummary("2401.00001", "ja")).toBe(false);
  });

  it("このタブで要約を変更すると、別タブへ論文IDつきで通知する", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);
    const received: DbChangeMessage[] = [];
    otherTab.addEventListener("message", (event: MessageEvent<DbChangeMessage>) => {
      received.push(event.data);
    });

    await useSummaryStore.getState().addSummary(createSampleSummary());

    await vi.waitFor(() => {
      expect(received).toContainEqual({
        dbName: mockDb.name,
        table: "paperSummaries",
        paperIds: ["2401.00001"],
      });
    });
  });

  it("別タブの変更の読み直しが先に反映されても、このタブで追加した版は重複しない", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    await initializeSummaryStore(mockDb);

    // 追加のコミット直後、Store の更新前に、別タブの通知による読み直しを割り込ませる
    const transaction = mockDb.transaction.bind(mockDb) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(mockDb, "transaction").mockImplementationOnce((async (...args: unknown[]) => {
      const result = await transaction(...args);
      notifyFromOtherTab(["2401.00001"]);
      await vi.waitFor(() => {
        expect(useSummaryStore.getState().summaries).toHaveLength(1);
      });
      return result;
    }) as never);

    await useSummaryStore.getState().addSummary(createSampleSummary());

    expect(await mockDb.paperSummaries.count()).toBe(1);
    expect(useSummaryStore.getState().summaries).toHaveLength(1);
    expect(useSummaryStore.getState().summaries[0]?.adopted).toBe(true);
  });

  it("初期ロード中に届いた別タブの変更は、初期ロードの完了後も残る", async () => {
    const { useSummaryStore, initializeSummaryStore } = await import("./summaryStore");
    useSummaryStore.setState({ summaries: [] });

    // 初期ロードの全件読み取りは、読み込み開始時点（空）の内容を読んだあと、反映を止めておく
    let readStarted = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const toCollection = mockDb.paperSummaries.toCollection.bind(mockDb.paperSummaries);
    vi.spyOn(mockDb.paperSummaries, "toCollection").mockImplementationOnce(() => {
      const collection = toCollection();
      return {
        each: async (
          callback: (summary: PaperSummary, cursor: { primaryKey: unknown }) => void
        ) => {
          const rows: [PaperSummary, unknown][] = [];
          await collection.each((summary, cursor) => {
            rows.push([summary, cursor.primaryKey]);
          });
          readStarted = true;
          await gate;
          for (const [summary, primaryKey] of rows) callback(summary, { primaryKey });
        },
      } as never;
    });

    const initializing = initializeSummaryStore(mockDb);
    await vi.waitFor(() => {
      expect(readStarted).toBe(true);
    });
    await mockDb.paperSummaries.add(
      createSampleSummary({ summary: "別タブの要約", adopted: true })
    );
    notifyFromOtherTab(["2401.00001"]);
    await vi.waitFor(() => {
      expect(useSummaryStore.getState().hasSummary("2401.00001", "ja")).toBe(true);
    });

    release();
    await initializing;

    const state = useSummaryStore.getState();
    expect(state.getSummaryByPaperIdAndLanguage("2401.00001", "ja")?.summary).toBe("別タブの要約");
    expect(state.isLoading).toBe(false);
  });
});
