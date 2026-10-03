import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../../shared/schemas/index";
import { createLuminaDb, type LuminaDB } from "../../db/db";
import {
  createDefaultPaperIndexClient,
  createInProcessPaperIndexClient,
  createWorkerPaperIndexClient,
  type PaperIndexLoadHandlers,
  PaperLoadError,
} from "./client";
import type { PaperIndexRequest, PaperIndexResponse } from "./protocol";

const createPaper = (id: string, day: number, embedding?: number[]): Paper => ({
  id,
  title: `Title ${id}`,
  abstract: "Abstract",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: new Date(Date.UTC(2024, 0, day)),
  updatedAt: new Date(Date.UTC(2024, 0, day)),
  pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
  ...(embedding ? { embedding } : {}),
});

const createHandlers = () => {
  const events: string[] = [];
  const handlers: PaperIndexLoadHandlers = {
    onProgress: vi.fn((total: number) => events.push(`progress:${total}`)),
    onBatch: vi.fn((papers, loadedCount: number) =>
      events.push(`batch:${papers.map((p) => p.id).join(",")}:${loadedCount}`)
    ),
    onLoaded: vi.fn((loadedCount: number) => events.push(`loaded:${loadedCount}`)),
    onError: vi.fn((error: Error) => events.push(`error:${error.message}`)),
  };
  return { handlers, events };
};

describe("createInProcessPaperIndexClient", () => {
  let db: LuminaDB;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    db = createLuminaDb(`paper-index-client-test-${counter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("保存済みの論文を読み込み、画面へは Embedding を含まない一覧用の論文だけを渡す", async () => {
    await db.papers.bulkAdd([createPaper("a", 1, [1, 0]), createPaper("b", 2)]);
    const client = createInProcessPaperIndexClient(db);
    const { handlers, events } = createHandlers();

    client.load(handlers);
    await vi.waitFor(() => expect(handlers.onLoaded).toHaveBeenCalled());

    expect(events).toEqual(["batch:b,a:2", "progress:2", "loaded:2"]);
    const [batch] = vi.mocked(handlers.onBatch).mock.calls[0] ?? [];
    expect(batch?.map((p) => ("embedding" in p ? "has" : "none"))).toEqual(["none", "none"]);
    expect(batch?.map((p) => p.hasEmbedding)).toEqual([false, true]);
  });

  it("読み込み後の検索・追加した論文の検索ができ、読み込み後も DB を閉じない", async () => {
    await db.papers.bulkAdd([createPaper("a", 1, [1, 0]), createPaper("b", 2, [0, 1])]);
    const client = createInProcessPaperIndexClient(db);
    const { handlers } = createHandlers();
    client.load(handlers);
    await vi.waitFor(() => expect(handlers.onLoaded).toHaveBeenCalled());

    expect((await client.search([1, 0], 0.5, 10)).matches.map((m) => m.id)).toEqual(["a"]);

    client.upsert([createPaper("c", 3, [1, 0.1])]);
    const result = await client.search([1, 0], 0.5, 10);
    expect(result.matches.map((m) => m.id)).toEqual(["a", "c"]);
    expect(result.totalMatchCount).toBe(2);
    expect(db.isOpen()).toBe(true);
  });

  it("破棄後の検索は reject する", async () => {
    const client = createInProcessPaperIndexClient(db);
    client.dispose();

    await expect(client.search([1], 0, 10)).rejects.toBeInstanceOf(PaperLoadError);
  });
});

/** Worker のテスト用の置き換え（送られたメッセージを記録し、応答・エラーをテストから流す） */
class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly sent: PaperIndexRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions
  ) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: PaperIndexRequest) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(data: PaperIndexResponse) {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  crash(message: string) {
    for (const listener of this.listeners.get("error") ?? []) {
      listener({ message, preventDefault: () => {} });
    }
  }
}

describe("createWorkerPaperIndexClient", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同一オリジンのモジュール Worker を起動し、DB 名とバッチ件数を送って読み込む", () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    const { handlers } = createHandlers();
    client.load(handlers);

    const worker = FakeWorker.instances[0];
    expect(worker?.options).toEqual({ type: "module" });
    expect(worker?.url.pathname).toMatch(/paperIndex\.worker\.ts$/);
    expect(worker?.sent).toEqual([
      { type: "load", dbName: "LuminaDB", firstBatchSize: 100, batchSize: 2000 },
    ]);
  });

  it("索引への反映は ID と Embedding だけを送る（全件は送らない）", () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    client.upsert([createPaper("a", 1, [0.5, 0.5])]);

    expect(FakeWorker.instances[0]?.sent).toEqual([
      { type: "upsert", papers: [{ id: "a", embedding: [0.5, 0.5] }] },
    ]);
  });

  it("検索の応答を requestId で対応づける", async () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    const worker = FakeWorker.instances[0] as FakeWorker;

    const first = client.search([1], 0.3, 10);
    const second = client.search([2], 0.3, 10);
    const [req1, req2] = worker.sent as Extract<PaperIndexRequest, { type: "search" }>[];
    worker.respond({
      type: "searchResult",
      requestId: req2?.requestId ?? -1,
      matches: [{ id: "b", score: 0.9 }],
      totalMatchCount: 1,
    });
    worker.respond({
      type: "searchResult",
      requestId: req1?.requestId ?? -1,
      matches: [{ id: "a", score: 0.8 }],
      totalMatchCount: 1,
    });

    expect((await first).matches[0]?.id).toBe("a");
    expect((await second).matches[0]?.id).toBe("b");
  });

  it("読み込みの失敗を PaperLoadError として通知する", () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    const { handlers } = createHandlers();
    client.load(handlers);

    FakeWorker.instances[0]?.respond({ type: "loadError", message: "QuotaExceededError" });

    const [error] = vi.mocked(handlers.onError).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(PaperLoadError);
    expect(error?.message).toContain("QuotaExceededError");
  });

  it("Worker が異常終了すると、実行中の検索を reject し、以降の検索も reject する", async () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    const { handlers } = createHandlers();
    client.load(handlers);
    const worker = FakeWorker.instances[0] as FakeWorker;
    worker.respond({ type: "loaded", loadedCount: 0 });

    const pending = client.search([1], 0.3, 10);
    worker.crash("out of memory");

    await expect(pending).rejects.toBeInstanceOf(PaperLoadError);
    await expect(client.search([1], 0.3, 10)).rejects.toThrow("再読み込みしてください");
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it("破棄すると Worker を終了する", () => {
    const client = createWorkerPaperIndexClient("LuminaDB");
    client.dispose();

    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});

describe("createDefaultPaperIndexClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Worker が応答する前に失敗したら、同じスレッドの処理へ切り替えて読み込みを続ける", async () => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createLuminaDb("paper-index-client-startup-failure-test");
    await db.papers.bulkAdd([createPaper("a", 1, [1, 0]), createPaper("b", 2, [0, 1])]);
    const client = createDefaultPaperIndexClient(db);
    const { handlers, events } = createHandlers();

    client.load(handlers);
    const worker = FakeWorker.instances[0] as FakeWorker;
    // スクリプトの取得失敗・CSP によるブロックでは、応答の前に error だけが届く
    worker.crash("Failed to fetch worker script");
    worker.crash("Failed to fetch worker script");

    await vi.waitFor(() => expect(handlers.onLoaded).toHaveBeenCalledWith(2));
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(events).toEqual(["batch:b,a:2", "progress:2", "loaded:2"]);
    expect(worker.terminated).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect((await client.search([1, 0], 0.5, 10)).matches.map((m) => m.id)).toEqual(["a"]);
    client.dispose();
    await db.delete();
  });

  it("読み込みが始まった後の Worker の失敗は切り替えずに onError で通知する", () => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createLuminaDb("paper-index-client-late-failure-test");
    const client = createDefaultPaperIndexClient(db);
    const { handlers } = createHandlers();

    client.load(handlers);
    const worker = FakeWorker.instances[0] as FakeWorker;
    worker.respond({ type: "batch", papers: [], loadedCount: 0 });
    worker.crash("out of memory");

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handlers.onError).mock.calls[0]?.[0]).toBeInstanceOf(PaperLoadError);
    expect(handlers.onLoaded).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("Worker を起動できない環境では同じスレッドで処理する", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by CSP");
        }
      }
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createLuminaDb("paper-index-client-default-test");
    await db.papers.add(createPaper("a", 1, [1]));
    const client = createDefaultPaperIndexClient(db);
    const { handlers } = createHandlers();

    client.load(handlers);
    await vi.waitFor(() => expect(handlers.onLoaded).toHaveBeenCalledWith(1));
    await db.delete();
  });
});
