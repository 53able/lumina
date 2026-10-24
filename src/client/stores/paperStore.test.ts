import { parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../db/db";
import { DB_CHANGE_CHANNEL_NAME, type DbChangeMessage } from "../lib/dbChangeChannel";
import type { PaperIndexClient, PaperIndexLoadHandlers } from "../lib/paperIndex/client";
import type { PaperListItem } from "../lib/paperIndex/core";

/**
 * paperStore テスト
 *
 * Design Docsに基づく仕様:
 * - 論文データの管理（CRUD操作）
 * - IndexedDBへの永続化
 * - カテゴリフィルタリング
 */

// モックDB
let mockDb: LuminaDB;

// テスト用のサンプル論文データ
const createSamplePaper = (overrides: Partial<Paper> = {}): Paper => ({
  id: "2401.00001",
  title: "Sample Paper Title",
  abstract: "This is a sample abstract.",
  authors: ["Author A", "Author B"],
  categories: ["cs.AI", "cs.LG"],
  publishedAt: parseISO("2024-01-01"),
  updatedAt: parseISO("2024-01-02"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
  embedding: Array(1536).fill(0.1),
  ...overrides,
});

/** 一覧用の論文（索引クライアントのバッチ用） */
const listItem = (id: string, publishedAt: string, title = "Stored Paper"): PaperListItem => {
  const { embedding: _embedding, ...rest } = createSamplePaper({
    id,
    title,
    publishedAt: parseISO(publishedAt),
  });
  return { ...rest, hasEmbedding: true };
};

/**
 * 手動でバッチ・完了・失敗を流せる索引クライアント（段階ロードの状態遷移の検証用）
 */
const createFakeIndexClient = (options: { onUpsert?: (papers: Paper[]) => void } = {}) => {
  let loadHandlers: PaperIndexLoadHandlers | null = null;
  const fake = {
    searchCalls: 0,
    handlers: (): PaperIndexLoadHandlers => {
      if (!loadHandlers) throw new Error("load has not been called");
      return loadHandlers;
    },
    client: {
      load: (handlers) => {
        loadHandlers = handlers;
      },
      upsert: (papers) => options.onUpsert?.(papers),
      search: async () => {
        fake.searchCalls += 1;
        return { matches: [], totalMatchCount: 0 };
      },
      dispose: () => {},
    } satisfies PaperIndexClient,
  };
  return fake;
};

describe("paperStore", () => {
  let testDbCounter = 0;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`paperStore-test-${testDbCounter}`);
  });

  afterEach(async () => {
    await mockDb.delete();
    vi.resetAllMocks();
  });

  describe("初期化", () => {
    it("正常系: 空の状態で初期化される", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const state = usePaperStore.getState();

      expect(state.papers).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("正常系: IndexedDBから既存データをロードする", async () => {
      // Arrange - DBに事前にデータを入れておく
      const existingPaper = createSamplePaper();
      await mockDb.papers.add(existingPaper);

      // Act
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const state = usePaperStore.getState();

      // Assert
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.id).toBe("2401.00001");
    });
  });

  describe("論文の追加", () => {
    it("正常系: 論文を追加できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();

      // Act
      await usePaperStore.getState().addPaper(paper);

      // Assert - Store
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.id).toBe("2401.00001");

      // Assert - IndexedDB永続化
      const dbPaper = await mockDb.papers.get("2401.00001");
      expect(dbPaper).toBeDefined();
      expect(dbPaper?.title).toBe("Sample Paper Title");
    });

    it("正常系: 複数の論文を一括追加できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const papers = [
        createSamplePaper({ id: "2401.00001" }),
        createSamplePaper({ id: "2401.00002", title: "Second Paper" }),
        createSamplePaper({ id: "2401.00003", title: "Third Paper" }),
      ];

      // Act
      await usePaperStore.getState().addPapers(papers);

      // Assert
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(3);

      const dbPapers = await mockDb.papers.toArray();
      expect(dbPapers).toHaveLength(3);
    });

    it("正常系: 既存の論文を更新する（upsert）", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();
      await usePaperStore.getState().addPaper(paper);

      // Act - 同じIDで更新
      const updatedPaper = createSamplePaper({ title: "Updated Title" });
      await usePaperStore.getState().addPaper(updatedPaper);

      // Assert
      const state = usePaperStore.getState();
      expect(state.papers).toHaveLength(1);
      expect(state.papers[0]?.title).toBe("Updated Title");
    });
  });

  describe("論文の取得", () => {
    it("正常系: IDで論文を取得できる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const paper = createSamplePaper();
      await usePaperStore.getState().addPaper(paper);

      // Act
      const retrieved = usePaperStore.getState().getPaperById("2401.00001");

      // Assert
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("2401.00001");
    });

    it("正常系: 存在しないIDはundefinedを返す", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      // Act
      const retrieved = usePaperStore.getState().getPaperById("nonexistent");

      // Assert
      expect(retrieved).toBeUndefined();
    });
  });

  describe("段階ロード（#65）", () => {
    it("先頭バッチで一覧を表示し、全件の準備完了で ready になる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const fake = createFakeIndexClient();
      const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });

      expect(usePaperStore.getState().loadStatus).toBe("loading");
      expect(usePaperStore.getState().isLoading).toBe(true);

      fake.handlers().onProgress(3);
      fake.handlers().onBatch([listItem("2401.00003", "2024-01-03")], 1);

      // 先頭バッチは即時に一覧へ反映し、まだ ready にしない
      expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual(["2401.00003"]);
      expect(usePaperStore.getState().loadedCount).toBe(1);
      expect(usePaperStore.getState().totalCount).toBe(3);
      expect(usePaperStore.getState().loadStatus).toBe("loading");

      fake
        .handlers()
        .onBatch([listItem("2401.00002", "2024-01-02"), listItem("2401.00001", "2024-01-01")], 3);
      fake.handlers().onLoaded(3);
      await done;

      const state = usePaperStore.getState();
      expect(state.loadStatus).toBe("ready");
      expect(state.isLoading).toBe(false);
      expect(state.papers.map((p) => p.id)).toEqual(["2401.00003", "2401.00002", "2401.00001"]);
      expect(state.loadedCount).toBe(3);
    });

    it("DB から公開日の降順で読み込み、一覧には Embedding 本体を持たない", async () => {
      await mockDb.papers.bulkAdd([
        createSamplePaper({ id: "2401.00001", publishedAt: parseISO("2024-01-01") }),
        createSamplePaper({
          id: "2401.00003",
          publishedAt: parseISO("2024-01-03"),
          embedding: undefined,
        }),
        createSamplePaper({ id: "2401.00002", publishedAt: parseISO("2024-01-02") }),
      ]);
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      const { papers } = usePaperStore.getState();
      expect(papers.map((p) => p.id)).toEqual(["2401.00003", "2401.00002", "2401.00001"]);
      expect(papers.map((p) => p.hasEmbedding)).toEqual([false, true, true]);
      expect(papers.every((p) => !("embedding" in p))).toBe(true);
    });

    it("読み込み中の追加は全件の準備完了まで待ち、後続のバッチで上書きされない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const fake = createFakeIndexClient();
      const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
      fake.handlers().onBatch([listItem("2401.00002", "2024-01-02")], 1);

      let added = false;
      const adding = usePaperStore
        .getState()
        .addPapers([createSamplePaper({ id: "2401.00001", title: "Synced" })])
        .then(() => {
          added = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(added).toBe(false);
      expect(await mockDb.papers.get("2401.00001")).toBeUndefined();

      fake.handlers().onBatch([listItem("2401.00001", "2024-01-01", "Stored")], 2);
      fake.handlers().onLoaded(2);
      await done;
      await adding;

      const paper = usePaperStore.getState().getPaperById("2401.00001");
      expect(paper?.title).toBe("Synced");
      expect(usePaperStore.getState().papers).toHaveLength(2);
    });

    it("読み込みに失敗すると error になり、再試行で一覧を残したまま読み込み直す", async () => {
      const { usePaperStore, initializePaperStore, whenPapersReady } = await import("./paperStore");
      const { PaperLoadError } = await import("../lib/paperIndex/client");
      const clients = [createFakeIndexClient(), createFakeIndexClient()];
      let created = 0;
      const done = initializePaperStore(mockDb, {
        createIndexClient: () => {
          const fake = clients[created];
          created += 1;
          if (!fake) throw new Error("unexpected client");
          return fake.client;
        },
      });
      clients[0]?.handlers().onBatch([listItem("2401.00002", "2024-01-02")], 1);
      clients[0]?.handlers().onError(new PaperLoadError("IndexedDB が開けません"));
      await done;

      const failed = usePaperStore.getState();
      expect(failed.loadStatus).toBe("error");
      expect(failed.isLoading).toBe(false);
      expect(failed.loadError?.message).toBe("IndexedDB が開けません");
      // 読み込めた分の一覧は残す
      expect(failed.papers.map((p) => p.id)).toEqual(["2401.00002"]);
      await expect(whenPapersReady()).rejects.toThrow("IndexedDB が開けません");
      // 失敗中の保存は既存論文を取り違えないよう拒否する
      await expect(usePaperStore.getState().addPapers([createSamplePaper()])).rejects.toThrow();

      const retrying = usePaperStore.getState().retryLoad();
      expect(usePaperStore.getState().loadStatus).toBe("loading");
      expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual(["2401.00002"]);
      clients[1]
        ?.handlers()
        .onBatch([listItem("2401.00002", "2024-01-02"), listItem("2401.00001", "2024-01-01")], 2);
      clients[1]?.handlers().onLoaded(2);
      await retrying;

      expect(usePaperStore.getState().loadStatus).toBe("ready");
      expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual([
        "2401.00002",
        "2401.00001",
      ]);
      await expect(whenPapersReady()).resolves.toBeUndefined();
    });

    it("2件目以降のバッチは BATCH_FLUSH_INTERVAL_MS 経過後にまとめて一覧へ反映する", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const fake = createFakeIndexClient();
        void initializePaperStore(mockDb, { createIndexClient: () => fake.client });
        fake.handlers().onBatch([listItem("2401.00003", "2024-01-03")], 1);
        fake.handlers().onBatch([listItem("2401.00002", "2024-01-02")], 2);
        fake.handlers().onBatch([listItem("2401.00001", "2024-01-01")], 3);

        // 先頭バッチの直後に届いた分はまだ反映しない
        expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual(["2401.00003"]);
        expect(usePaperStore.getState().loadedCount).toBe(1);

        vi.advanceTimersByTime(299);
        expect(usePaperStore.getState().papers).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual([
          "2401.00003",
          "2401.00002",
          "2401.00001",
        ]);
        expect(usePaperStore.getState().loadedCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("再試行の後に古い読み込みのタイマーが発火しても状態を変えない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const clients = [createFakeIndexClient(), createFakeIndexClient()];
      let created = 0;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        void initializePaperStore(mockDb, {
          createIndexClient: () => {
            const fake = clients[created];
            created += 1;
            if (!fake) throw new Error("unexpected client");
            return fake.client;
          },
        });
        clients[0]?.handlers().onBatch([listItem("2401.00003", "2024-01-03")], 1);
        // 古い読み込みの2件目はタイマー待ちのまま再試行する
        clients[0]?.handlers().onBatch([listItem("2401.00002", "2024-01-02")], 2);
        void usePaperStore.getState().retryLoad();

        vi.advanceTimersByTime(1000);

        const state = usePaperStore.getState();
        expect(state.papers.map((p) => p.id)).toEqual(["2401.00003"]);
        expect(state.loadedCount).toBe(0);
        expect(state.loadStatus).toBe("loading");
      } finally {
        vi.useRealTimers();
      }
    });

    it("新しい読み込みに置き換えられた読み込みの Promise も resolve する", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const clients = [createFakeIndexClient(), createFakeIndexClient()];
      let created = 0;
      const first = initializePaperStore(mockDb, {
        createIndexClient: () => {
          const fake = clients[created];
          created += 1;
          if (!fake) throw new Error("unexpected client");
          return fake.client;
        },
      });
      let firstSettled = false;
      void first.then(() => {
        firstSettled = true;
      });

      const second = usePaperStore.getState().retryLoad();
      await first;
      expect(firstSettled).toBe(true);
      // 置き換えた側の読み込みは続いている
      expect(usePaperStore.getState().loadStatus).toBe("loading");

      clients[1]?.handlers().onLoaded(0);
      await second;
      expect(usePaperStore.getState().loadStatus).toBe("ready");
    });

    it("索引クライアントを作れない場合も error にする（描画は止めない）", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb, {
        createIndexClient: () => {
          throw new Error("Worker blocked");
        },
      });

      expect(usePaperStore.getState().loadStatus).toBe("error");
      expect(usePaperStore.getState().loadError?.message).toContain("Worker blocked");
    });
  });

  describe("本文の所属出典の保存", () => {
    const evidence: NonNullable<Paper["paperAffiliationEvidence"]> = {
      organizations: ["OpenAI", "University"],
      sourceUrl: "https://arxiv.org/html/2401.00001v1",
      checkedAt: new Date("2024-01-03T12:00:00.000Z"),
    };

    it("現在のメタデータとEmbeddingを保ち、DB・索引・一覧と再読み込みへ反映する", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const current = createSamplePaper({
        title: "Latest title",
        authorAffiliations: [["Known author organization"], []],
      });
      await mockDb.papers.add(current);
      const onUpsert = vi.fn();
      const fake = createFakeIndexClient({ onUpsert });
      const load = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
      fake.handlers().onLoaded(1);
      await load;

      await usePaperStore
        .getState()
        .savePaperAffiliationEvidence(current.id, current.authors, current.updatedAt, evidence);

      const expected = { ...current, paperAffiliationEvidence: evidence };
      expect(await mockDb.papers.get(current.id)).toEqual(expected);
      expect(onUpsert).toHaveBeenCalledWith([expected]);
      expect(usePaperStore.getState().getPaperById(current.id)?.paperAffiliationEvidence).toEqual(
        evidence
      );
      await initializePaperStore(mockDb);
      expect(usePaperStore.getState().getPaperById(current.id)?.paperAffiliationEvidence).toEqual(
        evidence
      );
    });

    it.each([
      { authors: ["Author B", "Author A"] },
      { updatedAt: new Date("2024-01-04") },
    ])("古い取得元 $authors $updatedAt の結果は現在の論文を変更しない", async (changes) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const source = createSamplePaper();
      const current = createSamplePaper({ ...changes, paperAffiliationEvidence: evidence });
      await mockDb.papers.add(current);
      await initializePaperStore(mockDb);

      await expect(
        usePaperStore
          .getState()
          .savePaperAffiliationEvidence(source.id, source.authors, source.updatedAt, {
            ...evidence,
            organizations: ["Stale"],
          })
      ).rejects.toThrow("Affiliation source changed");
      expect(await mockDb.papers.get(current.id)).toEqual(current);
      expect(usePaperStore.getState().getPaperById(current.id)?.paperAffiliationEvidence).toEqual(
        evidence
      );
    });

    it("削除済み論文を再作成しない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);
      const source = createSamplePaper();
      await expect(
        usePaperStore
          .getState()
          .savePaperAffiliationEvidence(source.id, source.authors, source.updatedAt, evidence)
      ).rejects.toThrow("paper deleted");
      expect(await mockDb.papers.count()).toBe(0);
    });

    it("同じ著者・更新日の同期では所属出典を保持し、キャッシュで巻き戻さない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const current = createSamplePaper({ paperAffiliationEvidence: evidence });
      await mockDb.papers.add(current);
      await initializePaperStore(mockDb);
      await usePaperStore.getState().addPaper(createSamplePaper({ embedding: undefined }));
      expect((await mockDb.papers.get(current.id))?.paperAffiliationEvidence).toEqual(evidence);
      await usePaperStore.getState().addPapers(
        [
          createSamplePaper({
            updatedAt: new Date("2024-01-01"),
            paperAffiliationEvidence: { ...evidence, organizations: ["Old"] },
          }),
        ],
        { source: "cache" }
      );
      expect((await mockDb.papers.get(current.id))?.paperAffiliationEvidence).toEqual(evidence);
    });

    it.each([
      { authors: ["Author B", "Author A"] },
      { updatedAt: new Date("2024-01-04") },
    ])("同期で著者か更新日が変わった場合は古い所属出典を破棄する: %j", async (changes) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const current = createSamplePaper({ paperAffiliationEvidence: evidence });
      await mockDb.papers.add(current);
      await initializePaperStore(mockDb);
      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ ...changes, paperAffiliationEvidence: evidence }));
      expect((await mockDb.papers.get(current.id))?.paperAffiliationEvidence).toBeUndefined();
      expect(
        usePaperStore.getState().getPaperById(current.id)?.paperAffiliationEvidence
      ).toBeUndefined();
    });
  });

  describe("所属とEmbeddingの保存競合", () => {
    it("ネットワークは同一著者の所属とEmbeddingを保持し、明示空と著者順変更を反映する", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await mockDb.papers.add(createSamplePaper({ authorAffiliations: [["OpenAI"], ["Google"]] }));
      await initializePaperStore(mockDb);
      await usePaperStore.getState().addPaper(createSamplePaper({ embedding: undefined }));
      expect((await mockDb.papers.get("2401.00001"))?.authorAffiliations).toEqual([
        ["OpenAI"],
        ["Google"],
      ]);
      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ authorAffiliations: [[], []], embedding: undefined }));
      expect((await mockDb.papers.get("2401.00001"))?.authorAffiliations).toEqual([[], []]);
      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ authors: ["Author B", "Author A"], embedding: undefined }));
      expect((await mockDb.papers.get("2401.00001"))?.authorAffiliations).toBeUndefined();
      expect((await mockDb.papers.get("2401.00001"))?.embedding).toHaveLength(1536);
    });

    it.each(
      [undefined, [[], []], [["Old"], []]].flatMap((incoming) =>
        [
          [[], []],
          [["Google"], []],
        ].flatMap((saved) =>
          [
            ["Author A", "Author B"],
            ["B", "A"],
          ].map((authors) => ({ incoming, saved, authors }))
        )
      )
    )("キャッシュ $incoming は現在の著者と取得済み所属 $saved を巻き戻さない", async ({
      incoming,
      saved,
      authors,
    }) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const current = createSamplePaper({ title: "Latest", authors, authorAffiliations: saved });
      await mockDb.papers.add(current);
      await initializePaperStore(mockDb);
      await usePaperStore
        .getState()
        .addPapers([createSamplePaper({ authorAffiliations: incoming })], { source: "cache" });
      expect(await mockDb.papers.get(current.id)).toEqual(current);
    });

    it("キャッシュは同じ著者列の未取得所属だけ補完し、再読込でも残る", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const current = createSamplePaper({ title: "Latest" });
      await mockDb.papers.add(current);
      await initializePaperStore(mockDb);
      await usePaperStore
        .getState()
        .addPapers([createSamplePaper({ authorAffiliations: [["Google"], []] })], {
          source: "cache",
        });
      expect(await mockDb.papers.get(current.id)).toEqual({
        ...current,
        authorAffiliations: [["Google"], []],
      });
      await initializePaperStore(mockDb);
      expect(usePaperStore.getState().papers[0]?.authorAffiliations).toEqual([["Google"], []]);
      await usePaperStore
        .getState()
        .addPapers(
          [createSamplePaper({ authors: ["B", "A"], authorAffiliations: [["Wrong"], []] })],
          { source: "cache" }
        );
      expect(usePaperStore.getState().papers[0]?.authors).toEqual(current.authors);
    });

    it.each([
      { authorAffiliations: [[], []] },
      { authorAffiliations: [["Old"], []] },
    ])("遅延した単件・バッチEmbeddingは古い所属 $authorAffiliations や著者順を戻さない", async ({
      authorAffiliations,
    }) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const { runBackfillEmbeddings } = await import("../lib/backfillEmbeddings");
      const old = createSamplePaper({ authorAffiliations, embedding: undefined });
      await mockDb.papers.add(old);
      await initializePaperStore(mockDb);
      for (const batch of [false, true]) {
        let resolve!: (embedding: number[]) => void;
        const deferred = new Promise<number[]>((done) => {
          resolve = done;
        });
        const save = (paper: Paper) =>
          usePaperStore.getState().savePaperEmbeddings([
            {
              id: paper.id,
              title: paper.title,
              abstract: paper.abstract,
              embedding: paper.embedding ?? [],
            },
          ]);
        const running = runBackfillEmbeddings([old], {
          fetchEmbedding: () => deferred,
          ...(batch ? { fetchEmbeddingBatch: async () => [await deferred] } : {}),
          addPaper: save,
          addPapers: (papers) =>
            usePaperStore.getState().savePaperEmbeddings(
              papers.map((paper) => ({
                id: paper.id,
                title: paper.title,
                abstract: paper.abstract,
                embedding: paper.embedding ?? [],
              }))
            ),
        });
        await usePaperStore.getState().addPaper(
          createSamplePaper({
            authors: ["B", "A"],
            authorAffiliations: [["Google"], ["OpenAI"]],
            embedding: undefined,
          })
        );
        resolve([0.9]);
        await running;
        expect(await mockDb.papers.get(old.id)).toMatchObject({
          authors: ["B", "A"],
          authorAffiliations: [["Google"], ["OpenAI"]],
          embedding: [0.9],
        });
      }
    });

    it.each([
      { invalid: [["Wrong"]] },
      { invalid: [["Wrong"], "not a row"] },
      { invalid: [[3], []] },
    ])("不正な所属配列 $invalid は保存せず、ネットワーク取得で修復できる", async ({ invalid }) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);
      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ authorAffiliations: invalid as string[][] }));
      expect((await mockDb.papers.get("2401.00001"))?.authorAffiliations).toBeUndefined();
      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ authorAffiliations: [["Google"], []] }));
      expect((await mockDb.papers.get("2401.00001"))?.authorAffiliations).toEqual([["Google"], []]);
    });

    it.each([
      "title",
      "abstract",
      "deleted",
    ])("Embedding生成元 %s の変更はバッチ全体を保存前に拒否し公開しない", async (change) => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const papers = [
        createSamplePaper({ embedding: undefined }),
        createSamplePaper({ id: "second", embedding: undefined }),
      ];
      await mockDb.papers.bulkPut(papers);
      const upsert = vi.fn();
      const fake = createFakeIndexClient({ onUpsert: upsert });
      const ready = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
      fake.handlers().onLoaded(2);
      await ready;
      const { runBackfillEmbeddings } = await import("../lib/backfillEmbeddings");
      let resolve!: (vectors: number[][]) => void;
      const pending = new Promise<number[][]>((done) => {
        resolve = done;
      });
      const progress = vi.fn();
      const running = runBackfillEmbeddings(papers, {
        fetchEmbedding: async () => [1],
        fetchEmbeddingBatch: () => pending,
        addPaper: async () => {
          throw new Error("Batch callback expected");
        },
        addPapers: (completed) =>
          usePaperStore.getState().savePaperEmbeddings(
            completed.map((paper) => ({
              id: paper.id,
              title: paper.title,
              abstract: paper.abstract,
              embedding: paper.embedding ?? [],
            }))
          ),
        onProgress: progress,
      });
      if (change === "deleted") await mockDb.papers.delete("second");
      else await mockDb.papers.update("second", { [change]: "Changed" });
      const beforeList = usePaperStore.getState().papers;
      resolve([[1], [2]]);
      await expect(running).rejects.toThrow("Embedding source changed or paper deleted");
      expect(progress).not.toHaveBeenCalled();
      expect((await mockDb.papers.get("2401.00001"))?.embedding).toBeUndefined();
      expect(upsert).not.toHaveBeenCalled();
      expect(usePaperStore.getState().papers).toBe(beforeList);
      if (change === "deleted") expect(await mockDb.papers.get("second")).toBeUndefined();
    });
  });

  describe("保存と索引（#65）", () => {
    it("一覧用のフィールド hasEmbedding は DB に保存しない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await initializePaperStore(mockDb);

      await usePaperStore.getState().addPaper(createSamplePaper());
      const listed = usePaperStore.getState().getPaperById("2401.00001");
      expect(listed?.hasEmbedding).toBe(true);

      // 一覧用の論文を元にした更新（Embedding 補完など）
      await usePaperStore.getState().addPaper({ ...(listed as Paper), title: "Renamed" });

      const stored = await mockDb.papers.get("2401.00001");
      expect(stored).toBeDefined();
      expect("hasEmbedding" in (stored as object)).toBe(false);
      expect(stored?.title).toBe("Renamed");
    });

    it("Embedding を持たない論文で更新しても、保存済みの Embedding を消さない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await mockDb.papers.add(createSamplePaper());
      await initializePaperStore(mockDb);

      await usePaperStore
        .getState()
        .addPapers([createSamplePaper({ title: "Updated", embedding: undefined })]);

      const stored = await mockDb.papers.get("2401.00001");
      expect(stored?.title).toBe("Updated");
      expect(stored?.embedding).toHaveLength(1536);
      expect(usePaperStore.getState().getPaperById("2401.00001")?.hasEmbedding).toBe(true);
    });

    it("索引への反映は一覧の更新より前に行う", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const calls: string[] = [];
      const fake = createFakeIndexClient({
        onUpsert: () => {
          // 一覧の更新前に索引へ送る
          calls.push(`upsert:${usePaperStore.getState().papers.length}`);
        },
      });
      const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
      fake.handlers().onLoaded(0);
      await done;
      const unsubscribe = usePaperStore.subscribe((state) => {
        calls.push(`set:${state.papers.length}`);
      });

      await usePaperStore.getState().addPaper(createSamplePaper());
      unsubscribe();

      expect(calls).toEqual(["upsert:0", "set:1"]);
    });

    it("全件の準備完了後に索引を検索し、追加した論文も検索対象になる", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      await mockDb.papers.add(
        createSamplePaper({ id: "2401.00001", embedding: Array(1536).fill(0.1) })
      );
      await initializePaperStore(mockDb);

      const query = Array(1536).fill(0.1);
      const before = await usePaperStore.getState().searchPapers(query, 0.5, 10);
      expect(before.matches.map((m) => m.id)).toEqual(["2401.00001"]);

      await usePaperStore
        .getState()
        .addPaper(createSamplePaper({ id: "2401.00002", embedding: Array(1536).fill(0.2) }));
      const after = await usePaperStore.getState().searchPapers(query, 0.5, 10);
      expect(after.matches.map((m) => m.id).sort()).toEqual(["2401.00001", "2401.00002"]);
      expect(after.totalMatchCount).toBe(2);
    });

    it("読み込み中の検索は全件の準備完了まで結果を返さない", async () => {
      const { usePaperStore, initializePaperStore } = await import("./paperStore");
      const fake = createFakeIndexClient();
      const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });

      let settled = false;
      const searching = usePaperStore
        .getState()
        .searchPapers([1], 0.3, 10)
        .then((r) => {
          settled = true;
          return r;
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      expect(fake.searchCalls).toBe(0);

      fake.handlers().onLoaded(0);
      await done;
      await searching;
      expect(fake.searchCalls).toBe(1);
    });
  });
});

/**
 * 別タブの変更の反映（Issue #109）
 * 別タブは同じ IndexedDB に直接書き込み、別の BroadcastChannel から変更を通知するものとして模す
 */
describe("paperStore: 別タブの変更", () => {
  let testDbCounter = 0;
  let otherTab: BroadcastChannel;

  beforeEach(() => {
    testDbCounter += 1;
    mockDb = createLuminaDb(`paperStore-crossTab-test-${testDbCounter}`);
    otherTab = new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
  });

  afterEach(async () => {
    otherTab.close();
    vi.restoreAllMocks();
    await mockDb.delete();
  });

  const notifyFromOtherTab = (paperIds: string[]) => {
    otherTab.postMessage({
      dbName: mockDb.name,
      table: "papers",
      paperIds,
    } satisfies DbChangeMessage);
  };

  it("別タブで保存した論文だけを読み直し、索引と一覧へ反映する", async () => {
    const upserted: string[] = [];
    const fake = createFakeIndexClient({
      onUpsert: (papers) => upserted.push(...papers.map((p) => p.id)),
    });
    const { usePaperStore, initializePaperStore } = await import("./paperStore");
    const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
    fake.handlers().onBatch([listItem("2401.00001", "2024-01-01")], 1);
    fake.handlers().onLoaded(1);
    await done;

    await mockDb.papers.add(
      createSamplePaper({ id: "2401.00002", publishedAt: parseISO("2024-01-05") })
    );
    notifyFromOtherTab(["2401.00002"]);

    await vi.waitFor(() => {
      expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual([
        "2401.00002",
        "2401.00001",
      ]);
    });
    expect(upserted).toEqual(["2401.00002"]);
  });

  it("全件の準備中に届いた通知は、準備完了後に反映する", async () => {
    const fake = createFakeIndexClient();
    const { usePaperStore, initializePaperStore } = await import("./paperStore");
    const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });

    await mockDb.papers.add(createSamplePaper({ id: "2401.00002" }));
    notifyFromOtherTab(["2401.00002"]);
    // 通知が届く時間を置いても、準備完了前は一覧に足さない
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(usePaperStore.getState().papers).toEqual([]);

    fake.handlers().onLoaded(0);
    await done;
    await vi.waitFor(() => {
      expect(usePaperStore.getState().papers.map((p) => p.id)).toEqual(["2401.00002"]);
    });
  });

  it("このタブで論文を保存すると、別タブへ論文IDつきで通知する", async () => {
    const fake = createFakeIndexClient();
    const { usePaperStore, initializePaperStore } = await import("./paperStore");
    const done = initializePaperStore(mockDb, { createIndexClient: () => fake.client });
    fake.handlers().onLoaded(0);
    await done;
    const received: DbChangeMessage[] = [];
    otherTab.addEventListener("message", (event: MessageEvent<DbChangeMessage>) => {
      received.push(event.data);
    });

    await usePaperStore.getState().addPaper(createSamplePaper());

    await vi.waitFor(() => {
      expect(received).toContainEqual({
        dbName: mockDb.name,
        table: "papers",
        paperIds: ["2401.00001"],
      });
    });
  });
});
