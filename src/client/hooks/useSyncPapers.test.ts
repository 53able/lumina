/**
 * @vitest-environment jsdom
 *
 * useSyncPapers のテスト（順次取得の 50件×5並列 を含む）
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncPapers } from "./useSyncPapers";

/** 1リクエストあたりの最大取得件数（仕様） */
const BATCH_SIZE = 50;
/** 順次取得の並列数（仕様） */
const PARALLEL_COUNT = 5;

const mockSyncApi = vi.fn();
const mockGetDecryptedApiKey = vi.fn();

const mockEmbeddingApi = vi.fn();
vi.mock("../lib/api", () => ({
  syncApi: (...args: unknown[]) => mockSyncApi(...args),
  getDecryptedApiKey: () => mockGetDecryptedApiKey(),
  embeddingApi: (...args: unknown[]) => mockEmbeddingApi(...args),
}));

const mockRunBackfillEmbeddings = vi.fn();
vi.mock("../lib/backfillEmbeddings", () => ({
  runBackfillEmbeddings: (...args: unknown[]) => mockRunBackfillEmbeddings(...args),
}));

const mockAddPapers = vi.fn();
const mockAddPaper = vi.fn();
const mockSetLastSyncedAt = vi.fn();
const mockStartIncrementalSync = vi.fn();
const mockUpdateProgress = vi.fn();
const mockCompleteIncrementalSync = vi.fn();
const mockErrorIncrementalSync = vi.fn();

/** runEmbeddingBackfill 用: getState().papers で返すストアの論文（addPapers で更新される） */
const papersRef = {
  current: [] as Array<{ id: string; title?: string; abstract?: string; embedding?: number[] }>,
};

vi.mock("../stores/paperStore", () => ({
  usePaperStore: Object.assign(
    (selector: (s: unknown) => unknown) => {
      const state = {
        get papers() {
          return papersRef.current;
        },
        addPapers: mockAddPapers,
        addPaper: mockAddPaper,
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        get papers() {
          return papersRef.current;
        },
        addPapers: mockAddPapers,
        addPaper: mockAddPaper,
      }),
    }
  ),
}));

vi.mock("../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => {
    const state = { setLastSyncedAt: mockSetLastSyncedAt };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../stores/syncStore", () => ({
  useSyncStore: (selector: (s: unknown) => unknown) => {
    const state = {
      startIncrementalSync: mockStartIncrementalSync,
      updateProgress: mockUpdateProgress,
      completeIncrementalSync: mockCompleteIncrementalSync,
      errorIncrementalSync: mockErrorIncrementalSync,
    };
    return selector ? selector(state) : state;
  },
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: createTestQueryClient() }, children);

/** start に対応するモックレスポンスを返す（スタブ） */
const createMockResponse = (start: number, totalResults: number) => {
  const count = Math.min(BATCH_SIZE, Math.max(0, totalResults - start));
  const papers = Array.from({ length: count }, (_, i) => ({
    id: `paper-${start + i}`,
    title: `Title ${start + i}`,
    abstract: "Abstract",
    authors: ["Author"],
    categories: ["cs.AI"],
    publishedAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    pdfUrl: "https://arxiv.org/pdf/paper.pdf",
    arxivUrl: "https://arxiv.org/abs/paper",
  }));
  return {
    papers,
    fetchedCount: papers.length,
    totalResults,
    took: 100,
  };
};

describe("useSyncPapers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    papersRef.current = [];
    mockAddPapers.mockImplementation((newPapers: Array<{ id: string; embedding?: number[] }>) => {
      papersRef.current = [...papersRef.current, ...newPapers];
    });
    mockGetDecryptedApiKey.mockResolvedValue("test-api-key");
    mockRunBackfillEmbeddings.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("syncIncremental（順次取得）", () => {
    it("順次取得開始時に、1ラウンドで syncApi が 50件×5並列 で呼ばれる", async () => {
      const totalResults = 250;
      mockSyncApi.mockImplementation((req: { start?: number }) =>
        Promise.resolve(createMockResponse(req.start ?? 0, totalResults))
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.syncIncremental();
      });

      // レートリミット待機を経過させ、1ラウンドの処理が完了するまで時間を進める
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      // 仕様: 50件×5並列 → 1ラウンドで syncApi が5回呼ばれる
      expect(mockSyncApi).toHaveBeenCalledTimes(PARALLEL_COUNT);

      const expectedStarts = [0, 50, 100, 150, 200];
      const calls = mockSyncApi.mock.calls;
      const actualStarts = calls
        .map((c) => c[0] as { start?: number })
        .map((r) => r.start)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(actualStarts).toEqual(expectedStarts);

      calls.forEach((call) => {
        const req = call[0] as { maxResults?: number };
        expect(req.maxResults).toBe(BATCH_SIZE);
      });
    });

    /**
     * 契約: 既取得件数でオフセットを飛ばす。store に N 件あるとき、最初のリクエストは start >= N から始める。
     */
    it("store に N 件あるとき、最初のラウンドで syncApi に渡す start は N から始まり既取得範囲をリクエストしない", async () => {
      const storeCount = 100;
      const totalResults = 500;
      const basePaper = createMockResponse(0, 1).papers[0];
      papersRef.current = Array.from({ length: storeCount }, (_, i) => ({
        ...basePaper,
        id: `paper-${i}`,
      }));

      mockSyncApi.mockImplementation((req: { start?: number }) =>
        Promise.resolve(createMockResponse(req.start ?? 0, totalResults))
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.syncIncremental();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      const calls = mockSyncApi.mock.calls;
      const firstRoundCalls = calls.slice(0, PARALLEL_COUNT);
      const actualStarts = firstRoundCalls
        .map((c) => c[0] as { start?: number })
        .map((r) => r.start ?? 0)
        .sort((a, b) => a - b);
      const minStart = Math.min(...actualStarts);
      expect(minStart).toBe(storeCount);
      expect(actualStarts).toEqual([100, 150, 200, 250, 300]);
    });

    /**
     * 契約: 取得結果のうち ID が既存でないものだけを addPapers に渡し IndexedDB に保存する。
     */
    it("API が返した論文のうち既存 ID と重複するものは addPapers に渡さず新規 ID のみ渡す", async () => {
      papersRef.current = [createMockResponse(0, 1).papers[0]];
      const totalResults = 300;

      mockSyncApi.mockImplementation((req: { start?: number }) => {
        const res = createMockResponse(req.start ?? 0, totalResults);
        if (req.start === 1 && res.papers.length >= 2) {
          res.papers[0].id = "paper-0";
        }
        return Promise.resolve(res);
      });

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.syncIncremental();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(mockAddPapers).toHaveBeenCalled();
      const addedIds = mockAddPapers.mock.calls.flatMap((call) => {
        const arg = call[0] as Array<{ id: string }>;
        return Array.isArray(arg) ? arg.map((p) => p.id) : [];
      });
      expect(addedIds).not.toContain("paper-0");
    });

    /**
     * 契約: updateProgress には fetchedThisRun（今回の順次取得で取得した件数）が含まれる。
     */
    it("updateProgress に fetchedThisRun が渡され、今回の実行で取得した件数と一致する", async () => {
      const storeCount = 100;
      const totalResults = 500;
      const basePaper = createMockResponse(0, 1).papers[0];
      papersRef.current = Array.from({ length: storeCount }, (_, i) => ({
        ...basePaper,
        id: `paper-${i}`,
      }));

      mockSyncApi.mockImplementation((req: { start?: number }) =>
        Promise.resolve(createMockResponse(req.start ?? 0, totalResults))
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.syncIncremental();
      });
      // 順次取得が完了するまで複数ラウンド分のタイマーを進める（1ラウンド約10s + API）
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockUpdateProgress).toHaveBeenCalled();
      const lastCall = mockUpdateProgress.mock.calls[mockUpdateProgress.mock.calls.length - 1];
      const progress = lastCall[0] as {
        fetched: number;
        fetchedThisRun: number;
        remaining: number;
        total: number;
      };
      expect(progress).toHaveProperty("fetchedThisRun");
      // 今回の実行で取得した件数 = fetched - 開始時ストア件数。totalResults=500, storeCount=100 なので完了時 fetched=500, fetchedThisRun=400。
      expect(progress.fetchedThisRun).toBe(progress.fetched - storeCount);
      expect(progress.fetched).toBe(totalResults);
    });
  });

  describe("同期とEmbeddingバックフィルの切り離し", () => {
    it("sync成功後はrunBackfillEmbeddingsが呼ばれない（Embedding補完は手動ボタンから）", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 2));

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.sync();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRunBackfillEmbeddings).not.toHaveBeenCalled();
    });

    it("runEmbeddingBackfill呼び出し後バックフィル実行中は isEmbeddingBackfilling が true である", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 2));
      const backfillResolveRef = { current: null as (() => void) | null };
      mockRunBackfillEmbeddings.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            backfillResolveRef.current = resolve;
          })
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.sync();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(result.current.isEmbeddingBackfilling).toBe(false);

      await act(async () => {
        result.current.runEmbeddingBackfill();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(result.current.isEmbeddingBackfilling).toBe(true);

      await act(async () => {
        if (backfillResolveRef.current) backfillResolveRef.current();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(result.current.isEmbeddingBackfilling).toBe(false);
    });

    it("runEmbeddingBackfillはEmbeddingが無い論文を引数にrunBackfillEmbeddingsを1回呼ぶ", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 2));
      mockRunBackfillEmbeddings.mockResolvedValue(undefined);

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.sync();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(mockRunBackfillEmbeddings).not.toHaveBeenCalled();

      await act(async () => {
        result.current.runEmbeddingBackfill();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRunBackfillEmbeddings).toHaveBeenCalledTimes(1);
      const [papersPassed] = mockRunBackfillEmbeddings.mock.calls[0] as [unknown];
      expect(Array.isArray(papersPassed)).toBe(true);
      const papers = papersPassed as Array<{ embedding?: number[] }>;
      const allWithoutEmbedding = papers.every((p) => !p.embedding || p.embedding.length === 0);
      expect(allWithoutEmbedding).toBe(true);
    });
  });
});
