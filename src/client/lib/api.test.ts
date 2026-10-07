/**
 * クライアント API（embeddingApi / embeddingBatchApi の 429 リトライ・getRecommendedConcurrency・getDecryptedApiKey）のユニットテスト
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

describe("syncApi", () => {
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
        headers: new Headers({ "Retry-After": "120" }),
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
});

describe("API利用OFF時の実行境界", () => {
  const mockFetch = vi.fn();

  const mockApiEnabled = (apiEnabled: boolean, apiKey = "encrypted-key") => {
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      apiEnabled,
      apiKey,
    } as ReturnType<typeof useSettingsStore.getState>);
  };

  const okSyncResponse = () =>
    new Response(JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 1 }), {
      status: 200,
      headers: new Headers(),
    });

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
