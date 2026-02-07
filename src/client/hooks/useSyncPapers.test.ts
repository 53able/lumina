/**
 * @vitest-environment jsdom
 *
 * useSyncPapers のテスト
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncPapers } from "./useSyncPapers";

/** 1リクエストあたりの最大取得件数（仕様） */
const BATCH_SIZE = 50;

const mockSyncApi = vi.fn();
const mockGetDecryptedApiKey = vi.fn();

const mockEmbeddingApi = vi.fn();
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    syncApi: (...args: unknown[]) => mockSyncApi(...args),
    getDecryptedApiKey: () => mockGetDecryptedApiKey(),
    embeddingApi: (...args: unknown[]) => mockEmbeddingApi(...args),
  };
});

const mockRunBackfillEmbeddings = vi.fn();
vi.mock("../lib/backfillEmbeddings", () => ({
  runBackfillEmbeddings: (...args: unknown[]) => mockRunBackfillEmbeddings(...args),
}));

const mockAddPapers = vi.fn();
const mockAddPaper = vi.fn();
const mockSetLastSyncedAt = vi.fn();

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

  describe("syncAll（同期期間内の論文をすべて取得）", () => {
    it("正常系: totalResults=125 のとき syncApi が start=0, 50, 100 で3回呼ばれ store に125件入る", async () => {
      vi.useRealTimers();
      const totalResults = 125;
      mockSyncApi.mockImplementation((request: { start?: number }) =>
        Promise.resolve(createMockResponse(request?.start ?? 0, totalResults))
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        void result.current.syncAll();
      });

      await waitFor(
        () => {
          expect(mockSyncApi).toHaveBeenCalledTimes(3);
          const calls = mockSyncApi.mock.calls as Array<[{ start?: number }]>;
          expect(calls[0][0].start).toBe(0);
          expect(calls[1][0].start).toBe(50);
          expect(calls[2][0].start).toBe(100);
          expect(papersRef.current.length).toBe(125);
        },
        { timeout: 15_000 }
      );
      vi.useFakeTimers();
    });

    it("境界: totalResults=50（1ページのみ）のとき syncApi が1回だけ呼ばれる", async () => {
      vi.useRealTimers();
      const totalResults = 50;
      mockSyncApi.mockImplementation((request: { start?: number }) =>
        Promise.resolve(createMockResponse(request?.start ?? 0, totalResults))
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        void result.current.syncAll();
      });

      await waitFor(
        () => {
          expect(mockSyncApi).toHaveBeenCalledTimes(1);
          expect(mockSyncApi.mock.calls[0][0].start).toBe(0);
          expect(papersRef.current.length).toBe(50);
        },
        { timeout: 15_000 }
      );
      vi.useFakeTimers();
    });
  });
});
