import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaperEmbeddingIndex, type PaperEmbeddingInput, SEARCH_CHUNK_SIZE } from "./core";
import { createPaperIndexHost } from "./host";
import type { PaperIndexResponse } from "./protocol";

/** チャンクに分けて計算される件数（3チャンク分）の論文 */
const papers: PaperEmbeddingInput[] = Array.from({ length: SEARCH_CHUNK_SIZE * 3 }, (_, i) => {
  const angle = (i / (SEARCH_CHUNK_SIZE * 3)) * Math.PI;
  return { id: `p${i}`, embedding: [Math.cos(angle), Math.sin(angle)] };
});

const createHost = () => {
  const responses: PaperIndexResponse[] = [];
  const host = createPaperIndexHost({
    post: (response) => responses.push(response),
    openDb: () => {
      throw new Error("DB は使わない");
    },
  });
  host.handle({ type: "upsert", papers });
  return { host, responses };
};

const searchResults = (responses: PaperIndexResponse[]) =>
  responses.filter(
    (r): r is Extract<PaperIndexResponse, { type: "searchResult" }> => r.type === "searchResult"
  );

/** 実行中の検索がすべて終わるまで待つ（チャンクの合間はイベントループへ処理を返す） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * 検索がイベントループへ処理を返した回数を数える（host はチャンクの合間ごとに MessageChannel を1つ作る）。
 * 計算が進んだチャンク数の目安にする。
 */
const countYields = () => {
  const counter = { count: 0 };
  const Original = globalThis.MessageChannel;
  vi.stubGlobal(
    "MessageChannel",
    class extends Original {
      constructor() {
        super();
        counter.count += 1;
      }
    }
  );
  return counter;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPaperIndexHost の検索の中止（#111）", () => {
  it("中止した検索は結果を返さず、直後の検索だけが結果を返す", async () => {
    const { host, responses } = createHost();

    host.handle({
      type: "search",
      requestId: 1,
      queryEmbedding: [1, 0],
      scoreThreshold: 0,
      limit: 5,
    });
    host.handle({ type: "cancelSearch", requestId: 1 });
    host.handle({
      type: "search",
      requestId: 2,
      queryEmbedding: [0, 1],
      scoreThreshold: 0,
      limit: 5,
    });

    await vi.waitFor(() => expect(searchResults(responses)).toHaveLength(1));
    await settle();

    const reference = createPaperEmbeddingIndex();
    reference.upsert(papers);
    expect(responses).toEqual([
      { type: "searchResult", requestId: 2, ...reference.search([0, 1], 0, 5) },
    ]);
  });

  it("中止しない検索は並行しても、それぞれの requestId に自分の結果を返す", async () => {
    const { host, responses } = createHost();

    host.handle({
      type: "search",
      requestId: 1,
      queryEmbedding: [1, 0],
      scoreThreshold: 0.5,
      limit: 5,
    });
    host.handle({
      type: "search",
      requestId: 2,
      queryEmbedding: [0, 1],
      scoreThreshold: 0.5,
      limit: 5,
    });

    await vi.waitFor(() => expect(searchResults(responses)).toHaveLength(2));

    const reference = createPaperEmbeddingIndex();
    reference.upsert(papers);
    const byId = new Map(searchResults(responses).map((r) => [r.requestId, r]));
    expect(byId.get(1)).toEqual({
      type: "searchResult",
      requestId: 1,
      ...reference.search([1, 0], 0.5, 5),
    });
    expect(byId.get(2)).toEqual({
      type: "searchResult",
      requestId: 2,
      ...reference.search([0, 1], 0.5, 5),
    });
  });

  it("終了済み・未知の検索の中止は無視し、以降の検索に影響しない", async () => {
    const { host, responses } = createHost();
    host.handle({ type: "cancelSearch", requestId: 99 });

    host.handle({
      type: "search",
      requestId: 1,
      queryEmbedding: [1, 0],
      scoreThreshold: 0.9,
      limit: 1,
    });
    await vi.waitFor(() => expect(searchResults(responses)).toHaveLength(1));
    host.handle({ type: "cancelSearch", requestId: 1 });
    await settle();

    expect(searchResults(responses).map((r) => [r.requestId, r.matches[0]?.id])).toEqual([
      [1, "p0"],
    ]);
  });

  it("中止した検索の計算はそれ以上進まない", async () => {
    const { host, responses } = createHost();
    const yields = countYields();

    host.handle({
      type: "search",
      requestId: 1,
      queryEmbedding: [1, 0],
      scoreThreshold: 0,
      limit: 5,
    });
    host.handle({ type: "cancelSearch", requestId: 1 });
    await settle();

    // 最初のチャンクの後に1回処理を返したところで打ち切られ、残りのチャンク・並べ替えへ進まない
    expect(yields.count).toBe(1);
    expect(responses).toEqual([]);

    // 中止しなければ、3チャンク分（チャンクの合間2回と並べ替えの前1回）処理を返して結果を返す
    host.handle({
      type: "search",
      requestId: 2,
      queryEmbedding: [0, 1],
      scoreThreshold: 0,
      limit: 5,
    });
    await vi.waitFor(() => expect(searchResults(responses)).toHaveLength(1));
    expect(yields.count).toBe(1 + 3);
  });

  it("同じクエリで中止→再検索を繰り返しても（しきい値の連続変更）、計算をやり直さずに最新の検索へ結果を返す", async () => {
    const { host, responses } = createHost();
    const yields = countYields();
    const thresholds = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

    thresholds.forEach((scoreThreshold, i) => {
      if (i > 0) host.handle({ type: "cancelSearch", requestId: i });
      host.handle({
        type: "search",
        requestId: i + 1,
        queryEmbedding: [1, 0],
        scoreThreshold,
        limit: 5,
      });
    });
    const lastId = thresholds.length;
    await vi.waitFor(() =>
      expect(searchResults(responses).some((r) => r.requestId === lastId)).toBe(true)
    );
    await settle();
    // 計算の途中で中止された検索（1〜3）には結果を返さない
    for (const requestId of [1, 2, 3]) {
      expect(responses.some((r) => "requestId" in r && r.requestId === requestId)).toBe(false);
    }

    const reference = createPaperEmbeddingIndex();
    reference.upsert(papers);
    expect(searchResults(responses).find((r) => r.requestId === lastId)).toEqual({
      type: "searchResult",
      requestId: lastId,
      ...reference.search([1, 0], 0.4, 5),
    });
    // 全件の計算は1回分（処理を返すのは最大3回）。検索ごとに最初からやり直すと 5 + 3 回になる
    expect(yields.count).toBeLessThanOrEqual(3);
  });
});
