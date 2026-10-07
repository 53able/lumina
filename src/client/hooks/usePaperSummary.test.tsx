/**
 * @vitest-environment jsdom
 *
 * usePaperSummary のテスト
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeLockManager } from "../../test/fakeLockManager";
import { PartialSummaryError } from "../lib/summaryErrorTypes";
import { getSummaryLockName } from "../lib/summaryGenerationLock";
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

const mockGetSummaryByPaperIdAndLanguage = vi.fn();
const mockAddSummary = vi.fn();
const mockUpdateSummary = vi.fn();
const mockReloadSummaries = vi.fn();
/** 別のタブが保存した要約の読み直し先（中身は使わない） */
const mockDb = { name: "usePaperSummary-test" };
vi.mock("../stores/summaryStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/summaryStore")>()),
  reloadSummaries: (...args: unknown[]) => mockReloadSummaries(...args),
  useSummaryStore: () => ({
    _db: mockDb,
    summaries: [],
    getSummaryByPaperIdAndLanguage: (...args: unknown[]) =>
      mockGetSummaryByPaperIdAndLanguage(...args),
    addSummary: (...args: unknown[]) => mockAddSummary(...args),
    updateSummary: (...args: unknown[]) => mockUpdateSummary(...args),
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

const renderUsePaperSummary = (
  initialPaperId = "2401.00001",
  onError?: (error: Error, paperId: string) => void
) =>
  renderHook(({ paperId }) => usePaperSummary({ paperId, abstract: "Abstract", onError }), {
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

  it("正常系: キーポイントの根拠を版のレコードに保存する", async () => {
    const keyPointEvidence = [[{ index: 0, text: "First sentence." }], []];
    mockSummaryApi.mockResolvedValueOnce({
      ...createSummaryResponse("2401.00001"),
      keyPoints: ["要点1", "要点2"],
      keyPointEvidence,
    });
    const { result } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary();
    });

    expect(mockAddSummary).toHaveBeenCalledWith(expect.objectContaining({ keyPointEvidence }));
  });

  it("異常系: 根拠の形式が不正・キーポイントと数が合わない場合は根拠を保存しない（未確認として扱う）", async () => {
    for (const keyPointEvidence of [
      [[{ index: "0", text: "First sentence." }]],
      [[{ index: 0, text: "First sentence." }]],
    ]) {
      mockSummaryApi.mockResolvedValueOnce({
        ...createSummaryResponse("2401.00001"),
        keyPoints: ["要点1", "要点2"],
        keyPointEvidence,
      });
      const { result, unmount } = renderUsePaperSummary();

      await act(async () => {
        await result.current.generateSummary();
      });

      expect(mockAddSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyPointEvidence: undefined })
      );
      unmount();
    }
  });

  it("正常系: 説明文のみの生成では説明文だけを更新し、保存済みの根拠を上書きしない", async () => {
    const keyPointEvidence = [[{ index: 0, text: "First sentence." }]];
    const existing = {
      ...createSummaryResponse("2401.00001"),
      keyPoints: ["要点1"],
      keyPointEvidence,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    mockGetSummaryByPaperIdAndLanguage.mockReturnValue(existing);
    // 説明文のみの応答は keyPoints が空で、keyPointEvidence を含まない
    mockSummaryApi.mockResolvedValueOnce({
      ...createSummaryResponse("2401.00001"),
      summary: "",
      explanation: "説明文",
      targetAudience: "研究者",
      whyRead: "理由",
    });
    const { result } = renderUsePaperSummary();

    await act(async () => {
      await result.current.generateSummary(undefined, "explanation");
    });

    expect(mockAddSummary).not.toHaveBeenCalled();
    expect(mockUpdateSummary).toHaveBeenCalledWith("2401.00001", "ja", {
      explanation: "説明文",
      targetAudience: "研究者",
      whyRead: "理由",
    });
  });

  it("正常系: generatingTarget は生成中の生成の対象を返し、完了すると null に戻る", async () => {
    const generation = createDeferred<unknown>();
    mockSummaryApi.mockReturnValueOnce(generation.promise);
    const { result } = renderUsePaperSummary();
    expect(result.current.generatingTarget).toBeNull();

    act(() => {
      void result.current.generateSummary(undefined, "explanation");
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.generatingTarget).toBe("explanation");

    await act(async () => {
      generation.resolve(createSummaryResponse("2401.00001"));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.generatingTarget).toBeNull();
  });

  it("正常系: generatingTarget は表示中の論文の生成の対象を返す（Aで再生成中にBで説明文を生成してもAは both）", async () => {
    mockSummaryApi.mockReturnValue(new Promise(() => undefined));
    const { result, rerender } = renderUsePaperSummary("paper-a");

    act(() => {
      void result.current.generateSummary(undefined, "both");
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.generatingTarget).toBe("both");

    rerender({ paperId: "paper-b" });
    act(() => {
      void result.current.generateSummary(undefined, "explanation");
    });
    await waitFor(() => expect(mockSummaryApi).toHaveBeenCalledTimes(2));
    expect(result.current.generatingTarget).toBe("explanation");

    rerender({ paperId: "paper-a" });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.generatingTarget).toBe("both");
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

  it("正常系: 同じティックで連続して呼んでもAPIは1回だけ呼ばれる", async () => {
    mockSummaryApi.mockReturnValue(new Promise(() => undefined));
    const { result } = renderUsePaperSummary("paper-a");

    act(() => {
      void result.current.generateSummary();
      void result.current.generateSummary();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(mockSummaryApi).toHaveBeenCalledTimes(1);
  });

  it("正常系: StrictMode で effect が二重に実行されてもAPIは1回だけ呼ばれる", async () => {
    mockSummaryApi.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(
      () => {
        const paperSummary = usePaperSummary({ paperId: "paper-a", abstract: "Abstract" });
        const { generateSummary } = paperSummary;
        useEffect(() => {
          void generateSummary();
        }, [generateSummary]);
        return paperSummary;
      },
      { wrapper: createWrapper(), reactStrictMode: true }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(mockSummaryApi).toHaveBeenCalledTimes(1);
  });

  it("異常系: Aの生成中にBへ切り替えた後でAが失敗すると、onError にAの paperId を渡す", async () => {
    const generationA = createDeferred<unknown>();
    mockSummaryApi.mockReturnValueOnce(generationA.promise);
    const onError = vi.fn();
    const { result, rerender } = renderUsePaperSummary("paper-a", onError);

    act(() => {
      void result.current.generateSummary().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    rerender({ paperId: "paper-b" });
    await act(async () => {
      generationA.reject(new Error("timeout"));
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "paper-a", "both");
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

  it("異常系: 生成に失敗しても generateSummary は reject しない（失敗は error と onError で扱う）", async () => {
    mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
    const onError = vi.fn();
    const { result } = renderUsePaperSummary("2401.00001", onError);

    await act(async () => {
      await expect(result.current.generateSummary()).resolves.toBeUndefined();
    });

    await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  describe("工程別の失敗（部分成功）", () => {
    it("異常系: 説明文だけが失敗した応答では、要約を保存したうえで部分成功のエラーを返す", async () => {
      mockSummaryApi.mockResolvedValueOnce({
        ...createSummaryResponse("2401.00001"),
        explanationError: { code: "rate_limit", retryable: true },
      });
      const onError = vi.fn();
      const { result } = renderUsePaperSummary("2401.00001", onError);

      await act(async () => {
        await result.current.generateSummary();
      });

      expect(mockAddSummary).toHaveBeenCalledTimes(1);
      expect(mockAddSummary).toHaveBeenCalledWith(
        expect.objectContaining({ paperId: "2401.00001", summary: "要約", explanation: undefined })
      );
      await waitFor(() => expect(result.current.error).toBeInstanceOf(PartialSummaryError));
      const error = result.current.error as PartialSummaryError;
      expect(error.code).toBe("rate_limit");
      expect(error.retryable).toBe(true);
      expect(error.message).toBe(
        "要約は保存しました。AIの利用上限に達しました。時間をおいて再試行してください。"
      );
      expect(result.current.failedTarget).toBe("both");
      expect(result.current.isLoading).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(PartialSummaryError), "2401.00001", "both");
    });

    it("異常系: 未知の分類は upstream として扱う", async () => {
      mockSummaryApi.mockResolvedValueOnce({
        ...createSummaryResponse("2401.00001"),
        explanationError: { code: "something_new", retryable: true },
      });
      const { result } = renderUsePaperSummary();

      await act(async () => {
        await result.current.generateSummary();
      });

      await waitFor(() => expect(result.current.error).toBeInstanceOf(PartialSummaryError));
      expect((result.current.error as PartialSummaryError).code).toBe("upstream");
    });

    it("正常系: 説明文の再試行では説明文だけを要求し、保存済みの要約は部分更新で残す", async () => {
      const existingSummary = {
        paperId: "2401.00001",
        summary: "保存済みの要約",
        keyPoints: ["ポイント"],
        language: "ja" as const,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      mockGetSummaryByPaperIdAndLanguage.mockReturnValue(existingSummary);
      mockSummaryApi.mockResolvedValueOnce({
        ...createSummaryResponse("2401.00001"),
        summary: "",
        keyPoints: [],
        explanation: "説明文",
        targetAudience: "研究者",
        whyRead: "理由",
      });
      const { result } = renderUsePaperSummary();

      await act(async () => {
        await result.current.generateSummary(undefined, "explanation");
      });

      expect(mockSummaryApi).toHaveBeenCalledTimes(1);
      expect(mockSummaryApi).toHaveBeenCalledWith(
        "2401.00001",
        expect.objectContaining({ generateTarget: "explanation" }),
        expect.anything()
      );
      expect(mockUpdateSummary).toHaveBeenCalledWith("2401.00001", "ja", {
        explanation: "説明文",
        targetAudience: "研究者",
        whyRead: "理由",
      });
      // 要約を置き換える保存はしない
      expect(mockAddSummary).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
      expect(result.current.failedTarget).toBeNull();
    });

    it("異常系: 説明文の再試行が失敗すると failedTarget は explanation になる", async () => {
      mockGetSummaryByPaperIdAndLanguage.mockReturnValue({
        paperId: "2401.00001",
        summary: "保存済みの要約",
        keyPoints: [],
        language: "ja",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
      const onError = vi.fn();
      const { result } = renderUsePaperSummary("2401.00001", onError);

      await act(async () => {
        await result.current.generateSummary(undefined, "explanation");
      });

      await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
      expect(result.current.failedTarget).toBe("explanation");
      // トーストで説明文の失敗として出せるよう、失敗した生成の対象を渡す
      expect(onError).toHaveBeenCalledWith(expect.any(Error), "2401.00001", "explanation");
      expect(mockAddSummary).not.toHaveBeenCalled();
      expect(mockUpdateSummary).not.toHaveBeenCalled();
    });
  });

  describe("別のタブとの排他（Issue #128）", () => {
    let restoreLocks: (() => void) | undefined;
    afterEach(() => {
      restoreLocks?.();
      restoreLocks = undefined;
    });

    /** 別のタブが同じ論文・言語の要約を生成中の状態を作る（finish は生成の終了・タブを閉じたことを表す） */
    const holdLockInOtherTab = (paperId: string, language: "ja" | "en" = "ja") => {
      const { locks, restore } = installFakeLockManager();
      restoreLocks = restore;
      const otherTab = createDeferred<void>();
      void locks.request(getSummaryLockName(paperId, language), () => otherTab.promise);
      return { locks, finish: () => otherTab.resolve() };
    };

    it("正常系: 別のタブが生成中ならAPIを呼ばず、終了を待って保存された要約を読み直す", async () => {
      const { finish } = holdLockInOtherTab("2401.00001");
      mockReloadSummaries.mockResolvedValue(undefined);
      const { result } = renderUsePaperSummary("2401.00001");

      act(() => {
        void result.current.generateSummary();
      });
      await waitFor(() => expect(result.current.isLoading).toBe(true));
      expect(mockSummaryApi).not.toHaveBeenCalled();

      await act(async () => {
        finish();
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockSummaryApi).not.toHaveBeenCalled();
      expect(mockAddSummary).not.toHaveBeenCalled();
      expect(mockReloadSummaries).toHaveBeenCalledWith(mockDb, ["2401.00001"]);
      expect(result.current.error).toBeNull();
    });

    it("正常系: 別のタブの生成が終わる（タブを閉じる）と、このタブで生成できる", async () => {
      const { locks, finish } = holdLockInOtherTab("2401.00001");
      mockReloadSummaries.mockResolvedValue(undefined);
      const { result } = renderUsePaperSummary("2401.00001");

      act(() => {
        void result.current.generateSummary();
      });
      await waitFor(() => expect(result.current.isLoading).toBe(true));
      await act(async () => {
        finish();
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const generation = createDeferred<unknown>();
      mockSummaryApi.mockReturnValueOnce(generation.promise);
      act(() => {
        void result.current.generateSummary();
      });
      await waitFor(() => expect(mockSummaryApi).toHaveBeenCalledTimes(1));
      // 生成の間はロックを持ち、別のタブの生成を止める
      expect(locks.isHeld(getSummaryLockName("2401.00001", "ja"))).toBe(true);

      await act(async () => {
        generation.resolve(createSummaryResponse("2401.00001"));
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockAddSummary).toHaveBeenCalledTimes(1);
      expect(locks.isHeld(getSummaryLockName("2401.00001", "ja"))).toBe(false);
    });

    it("正常系: 別のタブが別の言語を生成中でも、この言語の生成は止めない", async () => {
      holdLockInOtherTab("2401.00001", "en");
      mockSummaryApi.mockResolvedValue(createSummaryResponse("2401.00001"));
      const { result } = renderUsePaperSummary("2401.00001");

      await act(async () => {
        await result.current.generateSummary("ja");
      });

      expect(mockSummaryApi).toHaveBeenCalledTimes(1);
      expect(mockAddSummary).toHaveBeenCalledTimes(1);
    });

    it("正常系: 生成に失敗してもロックを解放する", async () => {
      const { locks, restore } = installFakeLockManager();
      restoreLocks = restore;
      mockSummaryApi.mockRejectedValueOnce(new Error("timeout"));
      const { result } = renderUsePaperSummary("2401.00001");

      await act(async () => {
        await result.current.generateSummary();
      });

      await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
      expect(locks.isHeld(getSummaryLockName("2401.00001", "ja"))).toBe(false);
    });

    it("正常系: Web Locks の無い環境では排他せずに生成する", async () => {
      expect("locks" in navigator).toBe(false);
      mockSummaryApi.mockResolvedValue(createSummaryResponse("2401.00001"));
      const { result } = renderUsePaperSummary("2401.00001");

      await act(async () => {
        await result.current.generateSummary();
      });

      expect(mockSummaryApi).toHaveBeenCalledTimes(1);
      expect(mockAddSummary).toHaveBeenCalledTimes(1);
    });
  });
});
