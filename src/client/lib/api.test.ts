/**
 * クライアント API（embeddingApi / embeddingBatchApi の 429 リトライ・getRecommendedConcurrency・getDecryptedApiKey・
 * syncApi の送信間隔とリトライ）のユニットテスト
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/client/stores/settingsStore";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import {
  ApiDisabledError,
  EmbeddingRateLimitError,
  embeddingApi,
  embeddingBatchApi,
  getDecryptedApiKey,
  getRecommendedConcurrency,
  resetSyncIntervalForTest,
  SyncRateLimitError,
  searchApi,
  summaryApi,
  syncApi,
} from "./api";
import { SummaryApiError } from "./summaryErrorTypes";

// 既定は API 利用 ON・キー未設定
vi.mock("@/client/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({ apiEnabled: true, apiKey: "" })),
  },
}));

// sync の送信間隔（モジュール共有の最終送信時刻）を前のテストから引きずらない
beforeEach(() => {
  resetSyncIntervalForTest();
});

const okEmbeddingResponse = () =>
  new Response(
    JSON.stringify({
      embedding: Array(EMBEDDING_DIMENSION).fill(0.1),
      model: "text-embedding-3-small",
      took: 1,
    }),
    { status: 200, headers: new Headers() }
  );

const okSyncResponse = () =>
  new Response(JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 1 }), {
    status: 200,
    headers: new Headers(),
  });

const errorResponse = (status: number, retryAfter?: string) =>
  new Response(JSON.stringify({ error: "error", code: "rate_limit", retryable: true }), {
    status,
    headers: new Headers(retryAfter !== undefined ? { "Retry-After": retryAfter } : {}),
  });

/** fetch が呼ばれた時刻（fake timers の Date.now）を記録しつつ、順に応答を返す */
const respondInOrder = (
  mockFetch: ReturnType<typeof vi.fn>,
  responses: Array<() => Response | Promise<Response>>
): number[] => {
  const calledAt: number[] = [];
  mockFetch.mockImplementation(async () => {
    calledAt.push(Date.now());
    const next = responses[calledAt.length - 1];
    if (!next) throw new Error("unexpected fetch");
    return next();
  });
  return calledAt;
};

describe("embeddingApi", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("初回呼び出しでは待機せずすぐに fetch が 1 回呼ばれる", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding, model: "text-embedding-3-small", took: 100 }), {
        status: 200,
        headers: new Headers(),
      })
    );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await p;
  });

  it.each([
    ["Retry-After なし", undefined],
    ["Retry-After が 30 秒超", "31"],
  ])("429 で %s のときは再送せず EmbeddingRateLimitError を投げる", async (_label, retryAfter) => {
    respondInOrder(mockFetch, [() => errorResponse(429, retryAfter)]);

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    const expectReject = expect(p).rejects.toThrow(EmbeddingRateLimitError);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("429（Retry-After: 5）のときは 5 秒待って 1 回だけ再送し、成功を返す", async () => {
    const calledAt = respondInOrder(mockFetch, [
      () => errorResponse(429, "5"),
      () => okEmbeddingResponse(),
    ]);

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toHaveProperty("embedding");
    expect(calledAt).toHaveLength(2);
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(5_000);
  });

  it("429 の再送待ちの間に abort されたら再送せず AbortError を投げる", async () => {
    respondInOrder(mockFetch, [() => errorResponse(429, "5"), () => okEmbeddingResponse()]);

    const ac = new AbortController();
    const p = embeddingApi({ text: "test" }, { apiKey: "key", signal: ac.signal });
    const expectReject = expect(p).rejects.toMatchObject({ name: "AbortError" });
    // 前のテストから引き継いだ送信間隔の待ちを進め、1 回目の送信（429）を受け取らせる
    while (mockFetch.mock.calls.length === 0) {
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("再送も 429 なら EmbeddingRateLimitError を投げる（再送は 1 回だけ）", async () => {
    respondInOrder(mockFetch, [() => errorResponse(429, "5"), () => errorResponse(429, "5")]);

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    const expectReject = expect(p).rejects.toThrow(EmbeddingRateLimitError);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["サーバーの分類あり", JSON.stringify({ code: "quota" }), "quota"],
    ["ゲートウェイのプレーンテキスト", "DEPLOYMENT_DISABLED", undefined],
  ])("402 は本文の code を読む（%s）", async (_label, text, code) => {
    mockFetch.mockResolvedValueOnce(new Response(text, { status: 402 }));

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    const expectReject = expect(p).rejects.toMatchObject({ status: 402, code });
    await vi.runAllTimersAsync();
    await expectReject;
  });
});

describe("embeddingBatchApi", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Design Doc: embedding-backfill-as-is-analysis.md
   * 契約: バッチ API は 1 リクエスト = 1 スロット。2 回目以降は intervalMs * 1 だけ待つ（concurrency 倍ではない）。
   * フォールバック時 intervalMs=1000, concurrency=3 なので、1.1s 経過後に 2 回目を送れる（3 スロットなら 3s 必要）。
   */
  it("2回目呼び出しは 1*intervalMs 経過後に送る（concurrency倍ではない）", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    const embeddings = [embedding];
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            embeddings,
            model: "text-embedding-3-small",
            took: 100,
          }),
          { status: 200, headers: new Headers() }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            embeddings,
            model: "text-embedding-3-small",
            took: 100,
          }),
          { status: 200, headers: new Headers() }
        )
      );

    const p1 = embeddingBatchApi({ texts: ["a"] }, { apiKey: "key" });
    await vi.runAllTimersAsync();
    await p1;
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_100);

    const p2 = embeddingBatchApi({ texts: ["b"] }, { apiKey: "key" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await p2;
  });

  it("429（Retry-After: 5）のときは 5 秒待って 1 回だけ再送する", async () => {
    const embeddings = [Array(EMBEDDING_DIMENSION).fill(0.1)];
    const calledAt = respondInOrder(mockFetch, [
      () => errorResponse(429, "5"),
      () =>
        new Response(JSON.stringify({ embeddings, model: "m", took: 1 }), {
          status: 200,
          headers: new Headers(),
        }),
    ]);

    const p = embeddingBatchApi({ texts: ["a"] }, { apiKey: "key" });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ embeddings, model: "m", took: 1 });
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(5_000);
  });
});

describe("getDecryptedApiKey", () => {
  beforeEach(async () => {
    const { useSettingsStore } = await import("@/client/stores/settingsStore");
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      hasApiKey: () => true,
      canUseApi: () => false,
      getApiKeyAsync: async () => "sk-mock-key",
    } as ReturnType<typeof useSettingsStore.getState>);
  });

  it("hasApiKey() が true かつ canUseApi() が false のとき undefined を返す", async () => {
    const result = await getDecryptedApiKey();

    expect(result).toBeUndefined();
  });
});

describe("getRecommendedConcurrency", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("レスポンスに RateLimit-Remaining が無いときは 3 を返す（未取得時のデフォルト並列数）", () => {
    expect(getRecommendedConcurrency()).toBe(3);
  });

  it("embeddingApi が RateLimit-Remaining: 50 で返したあとは 4 にクリップされる", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding, model: "text-embedding-3-small", took: 100 }), {
        status: 200,
        headers: new Headers({
          "RateLimit-Remaining": "50",
          "RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 900),
        }),
      })
    );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    await vi.runAllTimersAsync();
    await p;

    expect(getRecommendedConcurrency()).toBe(4);
  });

  it("sync 応答の RateLimit-* は推奨並列数に影響しない（sync は別バケット）", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 1 }), {
        status: 200,
        headers: new Headers({
          "RateLimit-Remaining": "1",
          "RateLimit-Reset": "60",
        }),
      })
    );
    const before = getRecommendedConcurrency();

    await syncApi({ categories: ["cs.AI"] });

    expect(before).toBe(4);
    expect(getRecommendedConcurrency()).toBe(before);
  });

  it("embeddingApi が RateLimit-Remaining: 2 で返したあとは 2 を返す", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding, model: "text-embedding-3-small", took: 100 }), {
        status: 200,
        headers: new Headers({
          "RateLimit-Remaining": "2",
          "RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 900),
        }),
      })
    );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    // 前テストで remaining=50 のため intervalMs = windowLeft/50。並列4のため delayMs = intervalMs * 4。初回は待機スキップ済みなので 2 本目は待機する
    await vi.advanceTimersByTimeAsync(200_000);
    await p;

    expect(getRecommendedConcurrency()).toBe(2);
  }, 30_000);
});

describe("syncApi", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
    // ジッターを 0 に固定する（個別のテストで上書きする）
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it("existingPaperIds を渡したときリクエスト body に含まれる", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          papers: [],
          fetchedCount: 0,
          totalResults: 0,
          took: 10,
        }),
        { status: 200, headers: new Headers() }
      )
    );

    await syncApi(
      {
        categories: ["cs.AI"],
        existingPaperIds: ["2401.00001", "2401.00002"],
      },
      { apiKey: "key" }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [urlOrRequest, init] = mockFetch.mock.calls[0] as [string | Request, RequestInit?];
    const rawBody =
      typeof urlOrRequest === "object" && urlOrRequest instanceof Request
        ? await urlOrRequest.text()
        : (init?.body as string | undefined);
    const body = rawBody ? (JSON.parse(rawBody) as { existingPaperIds?: string[] }) : {};
    expect(body.existingPaperIds).toEqual(["2401.00001", "2401.00002"]);
  });

  it("429 の待機中に abort されたら再試行せず即座に中断する", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: new Headers({ "Retry-After": "30" }),
      })
    );

    const ac = new AbortController();
    const promise = syncApi({ categories: ["cs.AI"] }, { apiKey: "key", signal: ac.signal });

    await vi.advanceTimersByTimeAsync(0);
    ac.abort();

    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("連続して呼ぶと 2 回目の送信は 1 回目から 6 秒後になる（初回は即時）", async () => {
    const calledAt = respondInOrder(mockFetch, [okSyncResponse, okSyncResponse]);
    const startedAt = Date.now();

    await syncApi({ categories: ["cs.AI"] });
    expect(calledAt).toEqual([startedAt]);

    const second = syncApi({ categories: ["cs.AI"] });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(calledAt[1] - calledAt[0]).toBe(6_000);
  });

  it("送信間隔の待機中に abort されたら送信せず AbortError を投げる", async () => {
    respondInOrder(mockFetch, [okSyncResponse, okSyncResponse]);
    await syncApi({ categories: ["cs.AI"] });

    const ac = new AbortController();
    const second = syncApi({ categories: ["cs.AI"] }, { signal: ac.signal });
    const expectReject = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("送信間隔の待機中に abort されたら予約を取り消し、直後の再呼び出しは余計に待たない", async () => {
    const calledAt = respondInOrder(mockFetch, [okSyncResponse, okSyncResponse]);
    await syncApi({ categories: ["cs.AI"] });

    const ac = new AbortController();
    const aborted = syncApi({ categories: ["cs.AI"] }, { signal: ac.signal });
    const expectReject = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await expectReject;

    const retried = syncApi({ categories: ["cs.AI"] });
    await vi.runAllTimersAsync();
    await retried;
    // 取り消さなければ中断した予約（6 秒後）のさらに 6 秒後になる
    expect(calledAt[1] - calledAt[0]).toBe(6_000);
  });

  it("並行呼び出しの後続の予約が入っていれば、先の中断で予約を戻さない", async () => {
    const calledAt = respondInOrder(mockFetch, [okSyncResponse, okSyncResponse]);
    await syncApi({ categories: ["cs.AI"] });

    const ac = new AbortController();
    const aborted = syncApi({ categories: ["cs.AI"] }, { signal: ac.signal });
    const expectReject = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    const later = syncApi({ categories: ["cs.AI"] });
    await vi.advanceTimersByTimeAsync(1_000);
    ac.abort();
    await expectReject;

    await vi.runAllTimersAsync();
    await later;
    // 後続は中断された予約（6 秒後）のさらに 6 秒後のまま
    expect(calledAt[1] - calledAt[0]).toBe(12_000);
  });

  it("503 が続くと指数バックオフ（3 秒・6 秒以上）で再送し、成功を返す。onRateLimited は 1 回だけ", async () => {
    const calledAt = respondInOrder(mockFetch, [
      () => errorResponse(503),
      () => errorResponse(503),
      okSyncResponse,
    ]);
    const onRateLimited = vi.fn();

    const promise = syncApi({ categories: ["cs.AI"] }, { onRateLimited });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ fetchedCount: 0 });

    expect(calledAt).toHaveLength(3);
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(3_000);
    expect(calledAt[2] - calledAt[1]).toBeGreaterThanOrEqual(6_000);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
    expect(onRateLimited).toHaveBeenCalledWith("unavailable");
  });

  it("待ちにジッター（最大 20%）を加える", async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const calledAt = respondInOrder(mockFetch, [
      () => errorResponse(502),
      () => errorResponse(502),
      okSyncResponse,
    ]);

    const promise = syncApi({ categories: ["cs.AI"] });
    await vi.runAllTimersAsync();
    await promise;

    // 1 回目の待ち（3.3 秒）は送信間隔（6 秒）に隠れるため、2 回目（6 秒 × 1.1）で確かめる
    expect(calledAt[2] - calledAt[1]).toBe(6_600);
  });

  it("Retry-After がバックオフより長ければ Retry-After を優先する", async () => {
    const calledAt = respondInOrder(mockFetch, [() => errorResponse(429, "10"), okSyncResponse]);
    const onRateLimited = vi.fn();

    const promise = syncApi({ categories: ["cs.AI"] }, { onRateLimited });
    await vi.runAllTimersAsync();
    await promise;

    expect(calledAt[1] - calledAt[0]).toBe(10_000);
    expect(onRateLimited).toHaveBeenCalledWith("rate_limit");
  });

  it("待ちは 60 秒で打ち切る（503 の長い Retry-After）", async () => {
    vi.mocked(Math.random).mockReturnValue(0.99);
    const calledAt = respondInOrder(mockFetch, [() => errorResponse(503, "120"), okSyncResponse]);

    const promise = syncApi({ categories: ["cs.AI"] });
    await vi.runAllTimersAsync();
    await promise;

    expect(calledAt[1] - calledAt[0]).toBe(60_000);
  });

  it("Retry-After が 60 秒を超える 429 は待たずに SyncRateLimitError を投げる", async () => {
    respondInOrder(mockFetch, [() => errorResponse(429, "61")]);
    const onRateLimited = vi.fn();

    const error = await syncApi({ categories: ["cs.AI"] }, { onRateLimited }).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(SyncRateLimitError);
    expect((error as SyncRateLimitError).retryAfterSec).toBe(61);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onRateLimited).not.toHaveBeenCalled();
  });

  it("リトライ上限（3 回）を超えて 429 が続くと SyncRateLimitError を投げる", async () => {
    respondInOrder(
      mockFetch,
      Array(4).fill(() => errorResponse(429, "1"))
    );

    const promise = syncApi({ categories: ["cs.AI"] });
    const expectReject = expect(promise).rejects.toThrow(SyncRateLimitError);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("504（関数タイムアウト）は再送せず Error を投げる。onRateLimited は呼ばない", async () => {
    respondInOrder(mockFetch, [() => errorResponse(504), okSyncResponse]);
    const onRateLimited = vi.fn();

    const promise = syncApi({ categories: ["cs.AI"] }, { onRateLimited });
    const expectReject = expect(promise).rejects.toThrow("Sync failed: 504");
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onRateLimited).not.toHaveBeenCalled();
  });

  it("fetch のネットワーク失敗（TypeError）は再送する", async () => {
    const calledAt = respondInOrder(mockFetch, [
      () => Promise.reject(new TypeError("Failed to fetch")),
      okSyncResponse,
    ]);
    const onRateLimited = vi.fn();

    const promise = syncApi({ categories: ["cs.AI"] }, { onRateLimited });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toMatchObject({ fetchedCount: 0 });
    expect(calledAt[1] - calledAt[0]).toBeGreaterThanOrEqual(6_000);
    expect(onRateLimited).toHaveBeenCalledWith("network");
  });

  it("最後の試行もネットワーク失敗なら、日本語の Error で包んで投げる（元の例外は cause）", async () => {
    const networkError = new TypeError("Failed to fetch");
    respondInOrder(
      mockFetch,
      Array(4).fill(() => Promise.reject(networkError))
    );

    const promise = syncApi({ categories: ["cs.AI"] });
    const expectReject = expect(promise).rejects.toMatchObject({
      message: "ネットワークに接続できませんでした。接続を確認してから再度お試しください。",
      cause: networkError,
    });
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("fetch の AbortError は再送せずそのまま投げる", async () => {
    respondInOrder(mockFetch, [
      () => Promise.reject(new DOMException("aborted", "AbortError")),
      okSyncResponse,
    ]);

    const promise = syncApi({ categories: ["cs.AI"] });
    const expectReject = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("API利用OFF時の実行境界", () => {
  const mockFetch = vi.fn();

  const mockApiEnabled = (apiEnabled: boolean, apiKey = "encrypted-key") => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      apiEnabled,
      apiKey,
    } as ReturnType<typeof useSettingsStore.getState>);
  };

  /** fetch に渡されたリクエスト body を JSON で取り出す */
  const readRequestBody = async (call: unknown[]): Promise<Record<string, unknown>> => {
    const [urlOrRequest, init] = call as [string | Request, RequestInit?];
    const raw =
      urlOrRequest instanceof Request ? await urlOrRequest.text() : (init?.body as string);
    return JSON.parse(raw) as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      apiEnabled: true,
      apiKey: "",
    } as ReturnType<typeof useSettingsStore.getState>);
    mockFetch.mockReset();
  });

  it("再開方法はキー保存済みなら「利用可能」をON、未保存ならキーの保存から案内する", async () => {
    mockApiEnabled(false, "encrypted-key");
    await expect(searchApi({ query: "q", limit: 10 })).rejects.toMatchObject({
      resumeHint: "設定の「利用可能」をONにすると再開できます。",
    });

    mockApiEnabled(false, "");
    await expect(searchApi({ query: "q", limit: 10 })).rejects.toMatchObject({
      resumeHint: "設定でAPIキーを保存し、「利用可能」をONにすると再開できます。",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["サーバーの分類あり", JSON.stringify({ code: "quota" }), "quota"],
    ["ゲートウェイのプレーンテキスト", "DEPLOYMENT_DISABLED", undefined],
  ])("検索の 402 は本文の code を読む（%s）", async (_label, text, code) => {
    mockApiEnabled(true);
    mockFetch.mockImplementation(async () => new Response(text, { status: 402 }));

    await expect(searchApi({ query: "q", limit: 10 })).rejects.toMatchObject({ status: 402, code });
  });

  it("Embedding の送信間隔の待機中に OFF にされたら送信しない", async () => {
    vi.useFakeTimers();
    mockApiEnabled(true);
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ embedding, model: "m", took: 1 }), {
          status: 200,
          headers: new Headers(),
        })
    );
    // 1本目で送信時刻を記録し、2本目を待機させる
    const first = embeddingApi({ text: "first" });
    await vi.runAllTimersAsync();
    await first;
    const callsBefore = mockFetch.mock.calls.length;

    const second = embeddingApi({ text: "second" });
    const expectReject = expect(second).rejects.toThrow(ApiDisabledError);
    mockApiEnabled(false);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(callsBefore);
  });

  it("Embedding の 429 再送の待機中に OFF にされたら再送しない", async () => {
    vi.useFakeTimers();
    mockApiEnabled(true);
    // 429 を返すと同時に OFF にし、再送待ちの間は OFF のままにする
    respondInOrder(mockFetch, [
      () => {
        mockApiEnabled(false);
        return errorResponse(429, "5");
      },
      okEmbeddingResponse,
    ]);

    const pending = embeddingApi({ text: "t" });
    const expectReject = expect(pending).rejects.toThrow(ApiDisabledError);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sync の 429 再送前に OFF にされたら、再送で skipEmbedding: true を送る", async () => {
    vi.useFakeTimers();
    mockApiEnabled(true);
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
        })
      )
      .mockResolvedValueOnce(okSyncResponse());

    const promise = syncApi(
      { categories: ["cs.AI"] },
      {
        onRateLimited: () => mockApiEnabled(false),
      }
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await readRequestBody(mockFetch.mock.calls[0])).not.toHaveProperty("skipEmbedding");
    expect((await readRequestBody(mockFetch.mock.calls[1])).skipEmbedding).toBe(true);
  });

  it("OFF のとき searchApi は fetch せず ApiDisabledError を投げる", async () => {
    mockApiEnabled(false);
    await expect(searchApi({ query: "transformer", limit: 10 })).rejects.toThrow(ApiDisabledError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("OFF のとき summaryApi は fetch せず ApiDisabledError を投げる", async () => {
    mockApiEnabled(false);
    await expect(summaryApi("2401.00001", { language: "ja" })).rejects.toThrow(ApiDisabledError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("OFF のとき embeddingApi / embeddingBatchApi は fetch せず ApiDisabledError を投げる", async () => {
    mockApiEnabled(false);
    await expect(embeddingApi({ text: "test" })).rejects.toThrow(ApiDisabledError);
    await expect(embeddingBatchApi({ texts: ["a", "b"] })).rejects.toThrow(ApiDisabledError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ON のとき summaryApi は fetch する", async () => {
    mockApiEnabled(true);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paperId: "2401.00001",
          summary: "要約",
          keyPoints: [],
          language: "ja",
          createdAt: "2024-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: new Headers() }
      )
    );

    await summaryApi("2401.00001", { language: "ja" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 旧形式の ID のスラッシュでパスのセグメントが分かれないよう、%2F にして送る（Issue #108）
  it.each([
    ["2401.00001", "/api/v1/summary/2401.00001"],
    ["math.GT/0309136", "/api/v1/summary/math.GT%2F0309136"],
  ])("summaryApi は論文ID（%s）を1つのパスセグメントとして送る", async (paperId, pathname) => {
    mockApiEnabled(true);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paperId,
          summary: "要約",
          keyPoints: [],
          language: "ja",
          createdAt: "2024-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: new Headers() }
      )
    );

    await summaryApi(paperId, { language: "ja" });

    const [urlOrRequest] = mockFetch.mock.calls[0] as [string | Request];
    const url = urlOrRequest instanceof Request ? urlOrRequest.url : urlOrRequest;
    expect(new URL(url, "http://localhost").pathname).toBe(pathname);
  });

  it("OFF のとき syncApi は arXiv 同期を続け、skipEmbedding: true を送る", async () => {
    mockApiEnabled(false);
    mockFetch.mockResolvedValueOnce(okSyncResponse());

    await syncApi({ categories: ["cs.AI"] });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = await readRequestBody(mockFetch.mock.calls[0]);
    expect(body.skipEmbedding).toBe(true);
  });

  it("ON のとき syncApi は skipEmbedding を送らない", async () => {
    mockApiEnabled(true);
    mockFetch.mockResolvedValueOnce(okSyncResponse());

    await syncApi({ categories: ["cs.AI"] });

    const body = await readRequestBody(mockFetch.mock.calls[0]);
    expect(body).not.toHaveProperty("skipEmbedding");
  });
});

describe("summaryApi のエラー応答", () => {
  const mockFetch = vi.fn();
  const upstreamMessage = "Incorrect API key provided: sk-proj-abcd...wxyz";

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const respond = (status: number, body: unknown) =>
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status, headers: new Headers() })
    );

  const captureError = async (): Promise<SummaryApiError> => {
    const error = await summaryApi("2401.00001", { language: "ja", abstract: "abstract" }).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(SummaryApiError);
    return error as SummaryApiError;
  };

  it.each([
    [401, "auth", false, "APIキーの設定を確認してください。"],
    [429, "rate_limit", true, "AIの利用上限に達しました。時間をおいて再試行してください。"],
    [
      402,
      "quota",
      false,
      "OpenAIのBilling（請求）ページで利用残高を確認してください。残高が不足している間は、再試行しても解決しません。",
    ],
    [500, "upstream", true, "AIサービスでエラーが発生しました。再試行してください。"],
    [
      400,
      "invalid_input",
      false,
      "この論文のAbstractは要約できません（長さが上限を超えているなど）。再試行では解決しません。",
    ],
  ] as const)("%s の code（%s）から案内文を作る", async (status, code, retryable, message) => {
    respond(status, { error: "要約の生成に失敗しました", code, retryable });

    const error = await captureError();

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toBe(message);
  });

  it("応答の error に上流のエラー文があってもメッセージに含めない（旧形式の応答）", async () => {
    respond(500, { error: upstreamMessage });

    const error = await captureError();

    expect(error.code).toBe("upstream");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("sk-");
    expect(error.message).not.toContain("Incorrect API key");
  });

  it.each([
    [429, "rate_limit", true],
    [402, "upstream", true],
    [401, "auth", false],
    [403, "auth", false],
    [400, "invalid_input", false],
  ] as const)("JSON でない %s（ミドルウェアのプレーンテキストなど）はステータスから %s として扱う", async (status, code, retryable) => {
    mockFetch.mockResolvedValueOnce(
      new Response("Too many requests, please try again later.", {
        status,
        headers: new Headers({ "Content-Type": "text/plain" }),
      })
    );

    const error = await captureError();

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
  });

  it("JSON でない応答（ゲートウェイのエラーページなど）も upstream として扱う", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", { status: 502, headers: new Headers() })
    );

    const error = await captureError();

    expect(error.code).toBe("upstream");
    expect(error.retryable).toBe(true);
  });
});

describe("searchApi・embeddingApi のエラー応答（上流のエラー文を使わない）", () => {
  const mockFetch = vi.fn();
  const upstreamMessage = "Incorrect API key provided: sk-proj-abcd...wxyz";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("searchApi: 応答の error に上流のエラー文があってもメッセージに含めず、status を保つ", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: upstreamMessage }), {
        status: 401,
        headers: new Headers(),
      })
    );

    const error = await searchApi({ query: "q" } as never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { status: number }).status).toBe(401);
    expect((error as Error).message).not.toContain("sk-");
    expect((error as Error).message).not.toContain("Incorrect API key");
  });

  it("embeddingApi: 応答の error に上流のエラー文があってもメッセージに含めず、status を保つ", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: upstreamMessage }), {
        status: 500,
        headers: new Headers(),
      })
    );

    // 共有の送信間隔の状態に依らず待機を終わらせる
    const pending = embeddingApi({ text: "t" }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = await pending;

    expect(error).toBeInstanceOf(Error);
    expect((error as { status: number }).status).toBe(500);
    expect((error as Error).message).not.toContain("sk-");
    expect((error as Error).message).not.toContain("Incorrect API key");
  });
});
