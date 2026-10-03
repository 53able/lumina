/**
 * @vitest-environment jsdom
 *
 * usePaperSummary のテスト
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePaperSummary } from "./usePaperSummary";

const mockSummaryApi = vi.fn();
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    summaryApi: (...args: unknown[]) => mockSummaryApi(...args),
    getDecryptedApiKey: () => Promise.resolve("test-key"),
  };
});

vi.mock("../stores/summaryStore", () => ({
  useSummaryStore: () => ({
    getSummaryByPaperIdAndLanguage: () => undefined,
    addSummary: vi.fn(),
  }),
}));

const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const renderUsePaperSummary = (initialPaperId = "2401.00001") =>
  renderHook(({ paperId }) => usePaperSummary({ paperId, abstract: "Abstract" }), {
    wrapper: createWrapper(),
    initialProps: { paperId: initialPaperId },
  });

/** 外から解決・失敗させられる Promise */
const createDeferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createSummaryResponse = (paperId: string) => ({
  paperId,
  summary: "要約",
  keyPoints: [],
  language: "ja",
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("usePaperSummary", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("正常系: 生成に成功すると isLoading は false、error は null になる", async () => {
    mockSummaryApi.mockResolvedValueOnce(createSummaryResponse("2401.00001"));
    const { result } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(mockSummaryApi).toHaveBeenCalledTimes(1);
  });

  it("正常系: Aの生成中にBで生成してからAに戻ると、Aは生成中のまま", async () => {
    const generationA = createDeferred<unknown>();
    mockSummaryApi.mockReturnValueOnce(generationA.promise);
    mockSummaryApi.mockReturnValueOnce(new Promise(() => undefined));
    const { result, rerender } = renderUsePaperSummary("paper-a");

    act(() => {
      void result.current.generateSummary().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    rerender({ paperId: "paper-b" });
    act(() => {
      void result.current.generateSummary();
    });
    await waitFor(() => expect(mockSummaryApi).toHaveBeenCalledTimes(2));

    rerender({ paperId: "paper-a" });
    expect(result.current.isLoading).toBe(true);

    // 最後に開始した生成（B）でなくても、Aの失敗を返す
    await act(async () => {
      generationA.reject(new Error("timeout"));
    });
    await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
    expect(result.current.isLoading).toBe(false);
  });

  it("正常系: 同じ論文・言語の生成が実行中なら、再度呼んでもAPIは1回だけ呼ばれる", async () => {
    mockSummaryApi.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderUsePaperSummary("paper-a");

    act(() => {
      void result.current.generateSummary();
    });
    await waitFor(() => expect(mockSummaryApi).toHaveBeenCalledTimes(1));

    // 別の論文に移って戻ってきてから再度生成しても送らない
    rerender({ paperId: "paper-b" });
    rerender({ paperId: "paper-a" });
    await act(async () => {
      await result.current.generateSummary();
    });

    expect(mockSummaryApi).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(true);
  });

  it("異常系: 生成に失敗すると error が設定され、再生成の開始で null に戻る", async () => {
    mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
    expect(result.current.isLoading).toBe(false);

    // 応答を保留して生成中の状態を観測する
    mockSummaryApi.mockReturnValueOnce(new Promise(() => undefined));
    act(() => {
      void result.current.generateSummary();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("異常系: 別の論文に切り替えると元の論文の生成中・失敗を返さない", async () => {
    mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
    const { result, rerender } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ paperId: "2401.00002" });
    expect(result.current.error).toBeNull();

    // 生成中に切り替えた場合も、切替先ではローディングにしない
    rerender({ paperId: "2401.00001" });
    mockSummaryApi.mockReturnValueOnce(new Promise(() => undefined));
    act(() => {
      void result.current.generateSummary();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    rerender({ paperId: "2401.00002" });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("異常系: 別の言語に切り替えると元の言語の失敗を返さない", async () => {
    mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
    const { result } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.setSummaryLanguage("en");
    });
    expect(result.current.error).toBeNull();
  });
});
