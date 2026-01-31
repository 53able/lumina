/**
 * クライアント API（embeddingApi の 429 リトライ・getRecommendedConcurrency・getDecryptedApiKey）のユニットテスト
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSION } from "../../shared/schemas/index";
import { embeddingApi, getDecryptedApiKey, getRecommendedConcurrency } from "./api";

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

  it("429 時に Retry-After で待機してリトライし、2回目で 200 なら成功する", async () => {
    const embedding = Array(EMBEDDING_DIMENSION).fill(0.1);
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Too Many Requests" }), {
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embedding, model: "text-embedding-3-small", took: 100 }), {
          status: 200,
        })
      );

    const p = embeddingApi({ text: "test" }, { apiKey: "key" });
    // 送信間隔スロットル（初回 10s）＋ 429 Retry-After 1s ＋ リトライ前スロットル（最大 10s）
    await vi.advanceTimersByTimeAsync(25_000);
    const result = await p;

    expect(result.embedding).toHaveLength(EMBEDDING_DIMENSION);
    expect(result.embedding).toEqual(embedding);
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

  it("レスポンスに RateLimit-Remaining が無いときは 1 を返す", () => {
    expect(getRecommendedConcurrency()).toBe(1);
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
    await vi.advanceTimersByTimeAsync(25_000);
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
    // 前テストで remaining=50 のため getEmbeddingDelayMs = windowLeft/50（最大60sにキャップ）
    await vi.advanceTimersByTimeAsync(65_000);
    await p;

    expect(getRecommendedConcurrency()).toBe(5);
  }, 10_000);
});
