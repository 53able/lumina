/**
 * @vitest-environment jsdom
 *
 * useSyncPapers のテスト
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncStore } from "../stores/syncStore";
import { useSyncPapers } from "./useSyncPapers";

/** 1リクエストあたりの最大取得件数（仕様） */
const BATCH_SIZE = 50;
/** syncFromDate の1ページあたりの取得件数（仕様） */
const SYNC_FROM_DATE_PAGE_SIZE = 200;

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

/** syncFromDate 用のモックレスポンスを返す（1ページ200件） */
const createSyncFromDateResponse = (start: number, totalResults: number) => {
  const count = Math.min(SYNC_FROM_DATE_PAGE_SIZE, Math.max(0, totalResults - start));
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
    useSyncStore.getState().reset();
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

  describe("existingPaperIds の渡し方", () => {
    it("sync 実行時にストアの論文 ID が syncApi に existingPaperIds として渡される", async () => {
      papersRef.current = [
        { id: "store-paper-1", title: "T1", abstract: "A1" },
        { id: "store-paper-2", title: "T2", abstract: "A2" },
      ];
      mockSyncApi.mockResolvedValue(createMockResponse(0, 10));

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.sync();
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSyncApi).toHaveBeenCalled();
      const [request] = mockSyncApi.mock.calls[0] as [{ existingPaperIds?: string[] }];
      expect(request.existingPaperIds).toEqual(["store-paper-1", "store-paper-2"]);
    });

    it("syncMore 実行時にストアの論文 ID が syncApi に existingPaperIds として渡される", async () => {
      vi.useRealTimers();
      papersRef.current = Array.from({ length: 60 }, (_, i) => ({
        id: `paper-${i}`,
        title: `Title ${i}`,
        abstract: "A",
        authors: [],
        categories: ["cs.AI"],
        publishedAt: new Date(),
        updatedAt: new Date(),
        pdfUrl: "https://example.com/pdf",
        arxivUrl: "https://example.com/abs",
      }));
      mockSyncApi.mockResolvedValue(createMockResponse(50, 125));
      useSyncStore.getState().setRequestedRanges([[0, 50]]);
      useSyncStore.getState().setTotalResults(125);

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        await result.current.syncMore();
      });

      expect(mockSyncApi).toHaveBeenCalled();
      const [request] = mockSyncApi.mock.calls[0] as [
        { existingPaperIds?: string[]; start?: number },
      ];
      expect(request.start).toBe(50);
      const expectedIds = Array.from({ length: 10 }, (_, i) => `paper-${50 + i}`);
      expect(request.existingPaperIds).toEqual(expectedIds);
      vi.useFakeTimers();
    });
  });

  describe("初回同期の状態反映", () => {
    it("0件成功でも totalResults と最終同期日時を更新する", async () => {
      mockSyncApi.mockResolvedValue({
        papers: [],
        fetchedCount: 0,
        totalResults: 0,
        took: 100,
      });

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        await result.current.sync();
      });

      expect(result.current.totalResults).toBe(0);
      expect(result.current.hasMore).toBe(false);
      expect(mockSetLastSyncedAt).toHaveBeenCalledTimes(1);
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

    it("初回同期が未完了の間は、完了するまで isSyncingAll を維持する", async () => {
      let resolveInitialSync: ((value: ReturnType<typeof createMockResponse>) => void) | null =
        null;
      mockSyncApi.mockImplementation(
        (request: { start?: number }) =>
          new Promise((resolve) => {
            if ((request.start ?? 0) === 0) {
              resolveInitialSync = resolve;
            }
          })
      );

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      act(() => {
        void result.current.syncAll();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(useSyncStore.getState().isSyncingAll).toBe(true);
      expect(mockSyncApi).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveInitialSync?.(createMockResponse(0, 50));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(useSyncStore.getState().isSyncingAll).toBe(false);
      expect(papersRef.current.length).toBe(50);
    });
  });

  describe("syncFromDate（少ない日クリック時の遡り同期）", () => {
    it("クリックした日を終了日として toDate を渡し、period は常に 365 で最大365日前まで取得する", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 10));

      const { result } = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      await act(async () => {
        result.current.syncFromDate("2026-01-10");
      });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockSyncApi).toHaveBeenCalledTimes(1);
      const [request] = mockSyncApi.mock.calls[0] as [{ toDate?: string; period?: string }];
      // syncFromDate はユーザーの syncPeriodDays に依存せず、常に "365" で最大365日前まで取得する
      expect(request.period).toBe("365");
      expect(request.toDate).toBe("2026-01-10");
    });

    it("新規論文の保存完了後に成功コールバックを呼ぶ", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 1));

      let resolveAddPapers: (() => void) | null = null;
      mockAddPapers.mockImplementation(
        (newPapers: Array<{ id: string; embedding?: number[] }>) =>
          new Promise<void>((resolve) => {
            resolveAddPapers = () => {
              papersRef.current = [...papersRef.current, ...newPapers];
              resolve();
            };
          })
      );

      const onSyncFromDateSuccess = vi.fn();
      const onSyncFromDateError = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDateSuccess, onSyncFromDateError }
          ),
        { wrapper }
      );

      let syncPromise:
        | Promise<{
            addedCount: number;
            totalFetched: number;
            wasAborted: boolean;
          }>
        | undefined;
      await act(async () => {
        syncPromise = result.current.syncFromDate("2026-01-10");
        await Promise.resolve();
      });

      expect(onSyncFromDateSuccess).not.toHaveBeenCalled();
      expect(onSyncFromDateError).not.toHaveBeenCalled();

      if (!resolveAddPapers) {
        throw new Error("resolveAddPapers was not assigned");
      }
      resolveAddPapers();

      await act(async () => {
        await syncPromise;
      });

      expect(await syncPromise).toEqual({ addedCount: 1, totalFetched: 1, wasAborted: false });
      expect(onSyncFromDateSuccess).toHaveBeenCalledWith(1, 1);
      expect(onSyncFromDateError).not.toHaveBeenCalled();
    });

    it("各ページの保存完了後にページ単位コールバックを呼ぶ", async () => {
      mockSyncApi.mockImplementation((request: { start?: number }) =>
        Promise.resolve(createSyncFromDateResponse(request.start ?? 0, 250))
      );

      const onSyncFromDatePageCached = vi.fn();
      const onSyncFromDateSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDatePageCached, onSyncFromDateSuccess }
          ),
        { wrapper }
      );

      let syncResult:
        | {
            addedCount: number;
            totalFetched: number;
            wasAborted: boolean;
          }
        | undefined;
      await act(async () => {
        syncResult = await result.current.syncFromDate("2026-01-10");
      });

      expect(syncResult).toEqual({ addedCount: 250, totalFetched: 250, wasAborted: false });
      expect(onSyncFromDatePageCached).toHaveBeenCalledTimes(2);
      expect(onSyncFromDatePageCached).toHaveBeenNthCalledWith(1, 200, {
        pageStart: 0,
        totalAddedSoFar: 200,
        toDate: "2026-01-10",
      });
      expect(onSyncFromDatePageCached).toHaveBeenNthCalledWith(2, 50, {
        pageStart: 200,
        totalAddedSoFar: 250,
        toDate: "2026-01-10",
      });
      expect(onSyncFromDateSuccess).toHaveBeenCalledWith(250, 250);
    });

    it("ページ単位コールバックは保存完了前には呼ばれない", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 1));

      let resolveAddPapers: (() => void) | null = null;
      mockAddPapers.mockImplementation(
        (newPapers: Array<{ id: string; embedding?: number[] }>) =>
          new Promise<void>((resolve) => {
            resolveAddPapers = () => {
              papersRef.current = [...papersRef.current, ...newPapers];
              resolve();
            };
          })
      );

      const onSyncFromDatePageCached = vi.fn();

      const { result } = renderHook(
        () => useSyncPapers({ categories: ["cs.AI"], period: "30" }, { onSyncFromDatePageCached }),
        { wrapper }
      );

      let syncPromise:
        | Promise<{
            addedCount: number;
            totalFetched: number;
            wasAborted: boolean;
          }>
        | undefined;
      await act(async () => {
        syncPromise = result.current.syncFromDate("2026-01-10");
        await Promise.resolve();
      });

      expect(onSyncFromDatePageCached).not.toHaveBeenCalled();

      if (!resolveAddPapers) {
        throw new Error("resolveAddPapers was not assigned");
      }
      resolveAddPapers();

      await act(async () => {
        await syncPromise;
      });

      expect(onSyncFromDatePageCached).toHaveBeenCalledWith(1, {
        pageStart: 0,
        totalAddedSoFar: 1,
        toDate: "2026-01-10",
      });
    });

    it("新規論文がないページではページ単位コールバックを呼ばない", async () => {
      papersRef.current = [{ id: "paper-0", title: "Title 0", abstract: "Abstract" }];
      mockSyncApi.mockResolvedValue(createMockResponse(0, 1));

      const onSyncFromDatePageCached = vi.fn();
      const onSyncFromDateSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDatePageCached, onSyncFromDateSuccess }
          ),
        { wrapper }
      );

      let syncResult:
        | {
            addedCount: number;
            totalFetched: number;
            wasAborted: boolean;
          }
        | undefined;
      await act(async () => {
        syncResult = await result.current.syncFromDate("2026-01-10");
      });

      expect(syncResult).toEqual({ addedCount: 0, totalFetched: 1, wasAborted: false });
      expect(onSyncFromDatePageCached).not.toHaveBeenCalled();
      expect(onSyncFromDateSuccess).toHaveBeenCalledWith(0, 1);
    });

    it("保存失敗時は成功コールバックを呼ばずエラーコールバックを呼ぶ", async () => {
      mockSyncApi.mockResolvedValue(createMockResponse(0, 1));
      mockAddPapers.mockRejectedValue(new Error("DB write failed"));

      const onSyncFromDatePageCached = vi.fn();
      const onSyncFromDateSuccess = vi.fn();
      const onSyncFromDateError = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDatePageCached, onSyncFromDateSuccess, onSyncFromDateError }
          ),
        { wrapper }
      );

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.syncFromDate("2026-01-10");
        } catch (error) {
          caughtError = error instanceof Error ? error : new Error(String(error));
        }
      });

      expect(caughtError).toBeInstanceOf(Error);
      if (!(caughtError instanceof Error)) {
        throw new Error("caughtError was not assigned");
      }
      expect(caughtError.message).toBe("DB write failed");
      expect(onSyncFromDatePageCached).not.toHaveBeenCalled();
      expect(onSyncFromDateSuccess).not.toHaveBeenCalled();
      expect(onSyncFromDateError).toHaveBeenCalledTimes(1);
      expect(onSyncFromDateError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((onSyncFromDateError.mock.calls[0]?.[0] as Error).message).toBe("DB write failed");
    });

    it("別インスタンスからも syncFromDate の実行状態を参照できる", async () => {
      mockSyncApi.mockImplementation(
        (
          _request: unknown,
          options?: {
            signal?: AbortSignal;
          }
        ) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Sync aborted", "AbortError"));
            });
          })
      );

      const first = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });
      const second = renderHook(() => useSyncPapers({ categories: ["cs.AI"], period: "30" }), {
        wrapper,
      });

      let syncPromise: Promise<{
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      }> | null = null;

      await act(async () => {
        syncPromise = first.result.current.syncFromDate("2026-01-10");
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(first.result.current.isSyncingFromDate).toBe(true);
      expect(first.result.current.syncFromDateTarget).toBe("2026-01-10");
      expect(second.result.current.isSyncingFromDate).toBe(true);
      expect(second.result.current.syncFromDateTarget).toBe("2026-01-10");

      if (!syncPromise) {
        throw new Error("syncPromise was not created");
      }

      act(() => {
        second.result.current.stopSync();
      });

      let syncResult: {
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      } | null = null;
      await act(async () => {
        syncResult = await syncPromise;
      });
      expect(syncResult).toEqual({
        addedCount: 0,
        totalFetched: 0,
        wasAborted: true,
      });

      await act(async () => {
        await Promise.resolve();
      });

      expect(first.result.current.isSyncingFromDate).toBe(false);
      expect(first.result.current.syncFromDateTarget).toBeNull();
      expect(second.result.current.isSyncingFromDate).toBe(false);
      expect(second.result.current.syncFromDateTarget).toBeNull();
    });

    it("stopSync で syncFromDate を中断できる", async () => {
      mockSyncApi.mockImplementation(
        (
          _request: unknown,
          options?: {
            signal?: AbortSignal;
          }
        ) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Sync aborted", "AbortError"));
            });
          })
      );

      const onSyncFromDatePageCached = vi.fn();
      const onSyncFromDateSuccess = vi.fn();
      const onSyncFromDateError = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDatePageCached, onSyncFromDateSuccess, onSyncFromDateError }
          ),
        { wrapper }
      );

      let syncPromise: Promise<{
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      }> | null = null;
      await act(async () => {
        syncPromise = result.current.syncFromDate("2026-01-10");
        await Promise.resolve();
      });

      act(() => {
        result.current.stopSync();
      });

      let syncResult: {
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      } | null = null;
      await act(async () => {
        syncResult = await syncPromise;
      });

      expect(syncResult).toEqual({
        addedCount: 0,
        totalFetched: 0,
        wasAborted: true,
      });
      expect(result.current.isSyncingFromDate).toBe(false);
      expect(result.current.syncFromDateTarget).toBeNull();
      expect(onSyncFromDatePageCached).not.toHaveBeenCalled();
      expect(onSyncFromDateSuccess).not.toHaveBeenCalled();
      expect(onSyncFromDateError).not.toHaveBeenCalled();
    });

    it("中断時は保存済みページ分だけページ単位コールバックを残す", async () => {
      mockSyncApi.mockImplementation(
        (
          request: { start?: number },
          options?: {
            signal?: AbortSignal;
          }
        ) => {
          if ((request.start ?? 0) === 0) {
            return Promise.resolve(createSyncFromDateResponse(0, 250));
          }
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Sync aborted", "AbortError"));
            });
          });
        }
      );

      const onSyncFromDatePageCached = vi.fn();
      const onSyncFromDateSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useSyncPapers(
            { categories: ["cs.AI"], period: "30" },
            { onSyncFromDatePageCached, onSyncFromDateSuccess }
          ),
        { wrapper }
      );

      let syncPromise: Promise<{
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      }> | null = null;
      await act(async () => {
        syncPromise = result.current.syncFromDate("2026-01-10");
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onSyncFromDatePageCached).toHaveBeenCalledTimes(1);
      expect(onSyncFromDatePageCached).toHaveBeenCalledWith(200, {
        pageStart: 0,
        totalAddedSoFar: 200,
        toDate: "2026-01-10",
      });

      act(() => {
        result.current.stopSync();
      });

      let syncResult: {
        addedCount: number;
        totalFetched: number;
        wasAborted: boolean;
      } | null = null;
      await act(async () => {
        syncResult = await syncPromise;
      });

      expect(syncResult).toEqual({
        addedCount: 200,
        totalFetched: 200,
        wasAborted: true,
      });
      expect(onSyncFromDatePageCached).toHaveBeenCalledTimes(1);
      expect(onSyncFromDateSuccess).not.toHaveBeenCalled();
    });
  });
});
