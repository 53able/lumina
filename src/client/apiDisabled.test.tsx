/**
 * @vitest-environment jsdom
 *
 * API利用OFF時に新規の外部AI呼び出しが発生しないことをネットワーク層（fetch）で検証する（Issue #29）
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { parseISO } from "date-fns";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../shared/schemas/index";
import { ApiSettings } from "./components/ApiSettings";
import { InteractionProvider } from "./contexts/InteractionContext";
import { usePaperSummary } from "./hooks/usePaperSummary";
import { useSemanticSearch } from "./hooks/useSemanticSearch";
import { useSyncPapers } from "./hooks/useSyncPapers";
import { ApiDisabledError } from "./lib/api";
import { getEmptySearchMessage } from "./lib/emptySearchMessage";
import { PaperPage } from "./pages/PaperPage";
import { usePaperStore } from "./stores/paperStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useSummaryStore } from "./stores/summaryStore";
import { useSyncStore } from "./stores/syncStore";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

const paper: Paper = {
  id: "2401.00001",
  title: "Attention Is All You Need",
  abstract: "The dominant sequence transduction models...",
  authors: ["Ashish Vaswani"],
  categories: ["cs.CL"],
  publishedAt: parseISO("2024-01-01"),
  updatedAt: parseISO("2024-01-01"),
  pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
  arxivUrl: "https://arxiv.org/abs/2401.00001",
};

const summaryResponse = {
  paperId: paper.id,
  summary: "要約",
  keyPoints: ["ポイント"],
  language: "ja",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const fetchMock = vi.fn();

/** fetch に渡された URL のうち、指定パスを含むものの件数 */
const countRequests = (path: string): number =>
  fetchMock.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes(path);
  }).length;

const renderPaperPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
        <InteractionProvider>
          <Routes>
            <Route path="/papers/:id" element={<PaperPage />} />
          </Routes>
        </InteractionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const queryWrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("API利用OFF時の外部AI呼び出し停止", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(summaryResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    usePaperStore.setState({ papers: [paper], isLoading: false });
    // IndexedDB を使わずに保存できるようにする（前提確認テストで要約が返るため）
    useSummaryStore.setState({ summaries: [], addSummary: vi.fn(async () => {}) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("前提: 自動要約ON・API利用ONなら未要約論文を開くと summary リクエストが発生する", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: true });
    renderPaperPage();

    await waitFor(() => expect(countRequests("/api/v1/summary/")).toBe(1));
  });

  it("自動要約ONのままAPI利用をOFFにすると、未要約論文を開いても summary リクエストが発生しない", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: false });
    renderPaperPage();

    // 保存済みのローカルデータは閲覧できる
    expect(screen.getByText(paper.title)).toBeInTheDocument();
    expect(screen.getByText(paper.abstract)).toBeInTheDocument();
    // 自動発火の effect を流しきってからリクエスト数を確認する
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(countRequests("/api/v1/summary/")).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // 自動発火による毎回のエラー表示もしない
    expect(toastError).not.toHaveBeenCalled();
  });

  it("API利用OFF時は手動要約もリクエストせず、停止理由と再開方法をエラーとして返す", async () => {
    useSettingsStore.setState({ autoGenerateSummary: false, apiEnabled: false });
    const onError = vi.fn();
    const { result } = renderHook(
      () => usePaperSummary({ paperId: paper.id, abstract: paper.abstract, onError }),
      { wrapper: queryWrapper }
    );

    await act(async () => {
      await expect(result.current.generateSummary("ja", "both")).rejects.toThrow(ApiDisabledError);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    // PaperPage / App はこの onError で toast.error(description: err.message) を表示する
    const err = onError.mock.calls[0][0] as Error;
    expect(err.message).toContain("API利用がOFF");
    expect(err.message).toContain("「利用可能」をON");
  });

  it("API利用OFF時はAI検索のリクエストが発生せず、停止理由を空状態メッセージに表示する", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    const { result } = renderHook(() => useSemanticSearch({ papers: [paper] }));

    await act(async () => {
      await result.current.search("transformer");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error?.name).toBe("ApiDisabledError");

    const isSearchActive = result.current.expandedQuery !== null;
    render(
      <div>
        {getEmptySearchMessage(
          isSearchActive,
          result.current.results.length,
          result.current.error,
          result.current.queryEmbedding,
          result.current.isLoading
        )}
      </div>
    );
    expect(screen.getByText("API利用がOFFのためAI検索を停止しています")).toBeInTheDocument();
    expect(screen.getByText(/「利用可能」をONにすると再開できます/)).toBeInTheDocument();
  });

  it("API利用OFF時はEmbedding補完のリクエストが発生せず、停止理由と再開方法を結果に残す", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    useSyncStore.getState().setEmbeddingBackfillOutcome(null);
    const { result } = renderHook(() => useSyncPapers({ categories: ["cs.CL"], period: "30" }), {
      wrapper: queryWrapper,
    });

    await act(async () => {
      await result.current.runEmbeddingBackfill();
    });

    expect(countRequests("/api/v1/embedding")).toBe(0);
    const outcome = useSyncStore.getState().embeddingBackfillOutcome;
    expect(outcome?.status).toBe("failed");
    expect(outcome?.failure?.kind).toBe("api_disabled");
    expect(outcome?.failure?.guidance).toContain("「利用可能」をON");
  });

  it("設定画面でAPI利用OFF時に止まる処理と再開方法を説明する", () => {
    useSettingsStore.setState({ apiEnabled: false });
    render(<ApiSettings />);

    const status = screen.getByText("API利用がOFFのため、次の処理を停止しています")
      .parentElement as HTMLElement;
    expect(status).toHaveTextContent("API利用がOFFのため、次の処理を停止しています");
    expect(status).toHaveTextContent("AI検索");
    expect(status).toHaveTextContent("要約・説明文の生成（自動・手動とも）");
    expect(status).toHaveTextContent("Embedding補完");
    expect(status).toHaveTextContent("保存済みの論文・要約・検索履歴の閲覧は引き続き利用できます");
    expect(status).toHaveTextContent("「利用可能」をONにすると再開します");
  });

  it("API利用ON時は停止説明を表示しない", () => {
    useSettingsStore.setState({ apiEnabled: true });
    render(<ApiSettings />);

    expect(screen.queryByText(/API利用がOFFのため/)).not.toBeInTheDocument();
  });
});
