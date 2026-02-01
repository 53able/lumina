/**
 * クライアント API（embeddingApi / embeddingBatchApi の 429 リトライ・getRecommendedConcurrency・getDecryptedApiKey）のユニットテスト
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import {
  EmbeddingRateLimitError,
  embeddingApi,
  embeddingBatchApi,
  getDecryptedApiKey,
  getRecommendedConcurrency,
} from "./api";

vi.mock("@/client/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

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

  it("429 のときはリトライせず EmbeddingRateLimitError を投げる", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: new Headers({ "Retry-After": "1" }),
      })
    );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    const expectReject = expect(p).rejects.toThrow(EmbeddingRateLimitError);
    await vi.runAllTimersAsync();
    await expectReject;
    expect(mockFetch).toHaveBeenCalledTimes(1);
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

  it("embeddingApi が RateLimit-Remaining: 50 で返したあとは 10 にクリップされる", async () => {
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

    expect(getRecommendedConcurrency()).toBe(10);
  });

  it("embeddingApi が RateLimit-Remaining: 5 で返したあとは 5 を返す", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ embedding, model: "text-embedding-3-small", took: 100 }), {
        status: 200,
        headers: new Headers({
          "RateLimit-Remaining": "5",
          "RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 900),
        }),
      })
    );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    // 前テストで remaining=50 のため intervalMs = windowLeft/50。並列10のため delayMs = intervalMs * 10。初回は待機スキップ済みなので 2 本目は待機する
    await vi.advanceTimersByTimeAsync(200_000);
    await p;

    expect(getRecommendedConcurrency()).toBe(5);
  }, 30_000);
});
