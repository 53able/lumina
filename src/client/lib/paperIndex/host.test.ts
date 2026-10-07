import { describe, expect, it, vi } from "vitest";
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
});
