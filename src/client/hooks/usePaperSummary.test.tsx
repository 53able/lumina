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

describe("usePaperSummary", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
