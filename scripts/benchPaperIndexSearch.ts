/**
 * 論文索引の検索時間と、検索を中止してから次の検索結果が届くまでの時間を計測する（#111）
 *
 * 実行: pnpm exec tsx scripts/benchPaperIndexSearch.ts [件数=55000] [試行回数=5]
 *
 * - core: 同じスレッドで createPaperEmbeddingIndex().search を実行した時間
 * - worker: worker_threads 上の索引（createPaperIndexHost）へ検索Aを送り、
 *   ABORT_AFTER_MS 後に検索Aの中止と検索Bを送ってから、検索Bの結果が届くまでの時間
 *
 * 合成データ: 次元 EMBEDDING_DIMENSION（1536）、各成分は一様乱数（シード固定）
 */
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  createPaperEmbeddingIndex,
  type PaperEmbeddingInput,
} from "../src/client/lib/paperIndex/core";
import { createPaperIndexHost } from "../src/client/lib/paperIndex/host";
import type { PaperIndexRequest, PaperIndexResponse } from "../src/client/lib/paperIndex/protocol";
import { EMBEDDING_DIMENSION } from "../src/shared/schemas/embedding";

/** 検索Aを送ってから中止するまでの時間（ms） */
const ABORT_AFTER_MS = 20;

/** シード付きの乱数（xorshift32） */
const createRandom = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000 - 0.5;
  };
};

const randomVector = (random: () => number): number[] =>
  Array.from({ length: EMBEDDING_DIMENSION }, () => random());

/** 合成データを count 件、バッチに分けて upsert する */
const fillIndex = (upsert: (papers: PaperEmbeddingInput[]) => void, count: number): void => {
  const random = createRandom(42);
  for (let start = 0; start < count; start += 2000) {
    const papers: PaperEmbeddingInput[] = [];
    for (let i = start; i < Math.min(count, start + 2000); i += 1) {
      papers.push({ id: `paper-${i}`, embedding: randomVector(random) });
    }
    upsert(papers);
  }
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

const format = (values: number[]): string =>
  `中央値 ${median(values).toFixed(1)}ms（${values.map((v) => v.toFixed(1)).join(", ")}）`;

if (!isMainThread) {
  const port = parentPort;
  if (!port) throw new Error("parentPort がありません");
  const host = createPaperIndexHost({
    post: (response) => port.postMessage(response),
    openDb: () => {
      throw new Error("計測では DB を使いません");
    },
  });
  fillIndex((papers) => host.handle({ type: "upsert", papers }), workerData.count as number);
  port.on("message", (request: PaperIndexRequest) => host.handle(request));
  port.postMessage({ type: "ready" });
} else {
  const count = Number(process.argv[2] ?? 55000);
  const runs = Number(process.argv[3] ?? 5);
  const random = createRandom(7);

  // core: 同じスレッドでの検索時間
  const index = createPaperEmbeddingIndex();
  fillIndex(index.upsert, count);
  index.search(randomVector(random), 0, 20); // JIT のウォームアップ
  const coreTimes: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const query = randomVector(random);
    const start = performance.now();
    index.search(query, 0, 20);
    coreTimes.push(performance.now() - start);
  }

  // worker: 中止から次の検索結果までの時間
  // Worker には tsx の読み込みが引き継がれないため、tsx を登録してから自身を読み込む
  const worker = new Worker(
    `import("tsx/esm/api").then(({ register }) => { register(); return import(${JSON.stringify(import.meta.url)}); })`,
    { eval: true, workerData: { count } }
  );
  worker.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  const responses: PaperIndexResponse[] = [];
  let ready = false;
  let onResponse: (() => void) | null = null;
  worker.on("message", (response: PaperIndexResponse | { type: "ready" }) => {
    if (response.type === "ready") ready = true;
    else responses.push(response);
    onResponse?.();
  });
  const waitFor = (predicate: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = () => {
        if (!predicate()) return;
        onResponse = null;
        resolve();
      };
      onResponse = check;
      check();
    });
  const hasResult = (requestId: number) => () =>
    responses.some(
      (r) => (r.type === "searchResult" || r.type === "searchError") && r.requestId === requestId
    );
  const send = (request: PaperIndexRequest) => worker.postMessage(request);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  await waitFor(() => ready);

  let requestId = 0;
  const search = (id: number) =>
    send({
      type: "search",
      requestId: id,
      queryEmbedding: randomVector(random),
      scoreThreshold: 0,
      limit: 20,
    });

  // ウォームアップ
  requestId += 1;
  search(requestId);
  await waitFor(hasResult(requestId));

  const singleTimes: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    requestId += 1;
    const start = performance.now();
    search(requestId);
    await waitFor(hasResult(requestId));
    singleTimes.push(performance.now() - start);
  }

  const abortTimes: number[] = [];
  let abortedResultCount = 0;
  for (let run = 0; run < runs; run += 1) {
    requestId += 1;
    const abortedId = requestId;
    search(abortedId);
    await sleep(ABORT_AFTER_MS);
    requestId += 1;
    const nextId = requestId;
    const start = performance.now();
    send({ type: "cancelSearch", requestId: abortedId });
    search(nextId);
    await waitFor(hasResult(nextId));
    abortTimes.push(performance.now() - start);
    if (hasResult(abortedId)()) abortedResultCount += 1;
  }
  await sleep(200);
  await worker.terminate();

  console.log(
    `件数 ${count}・次元 ${EMBEDDING_DIMENSION}・試行 ${runs} 回（Node ${process.version}）`
  );
  console.log(`core.search（同一スレッド）: ${format(coreTimes)}`);
  console.log(`Worker 検索1回（送信→結果）: ${format(singleTimes)}`);
  console.log(
    `Worker 中止→次の検索結果（検索Aの送信 ${ABORT_AFTER_MS}ms 後に中止）: ${format(abortTimes)}`
  );
  console.log(`中止した検索の結果が届いた回数: ${abortedResultCount}/${runs}`);
}
