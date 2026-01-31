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

vi.mock("../stores/paperStore", () => ({
  usePaperStore: (selector: (s: unknown) => unknown) => {
    const state = {
      papers: [],
      addPapers: mockAddPapers,
      addPaper: mockAddPaper,
    };
    return selector ? selector(state) : state;
  },
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
  });

  describe("同期成功後のEmbeddingバックフィル", () => {
    it("sync成功後、Embeddingが無い論文を引数にrunBackfillEmbeddingsが1回呼ばれる", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 2));
      mockRunBackfillEmbeddings.mockResolvedValue(undefined);
      mockEmbeddingApi.mockResolvedValue({ embedding: Array(1536).fill(0.1) });

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.sync();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRunBackfillEmbeddings).toHaveBeenCalled();
      const firstCall = mockRunBackfillEmbeddings.mock.calls[0] as [unknown];
      const [papersPassed] = firstCall;
      expect(Array.isArray(papersPassed)).toBe(true);
      const papers = papersPassed as Array<{ embedding?: number[] }>;
      const allWithoutEmbedding = papers.every((p) => !p.embedding || p.embedding.length === 0);
      expect(allWithoutEmbedding).toBe(true);
    });

    it("sync成功後バックフィル実行中は isSyncing が true である", async () => {
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

      expect(result.current.isSyncing).toBe(true);

      await act(async () => {
        if (backfillResolveRef.current) backfillResolveRef.current();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isSyncing).toBe(false);
    });

    it("バックフィル完了後は isSyncing が false である", async () => {
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

      expect(result.current.isSyncing).toBe(false);
    });
  });
});
