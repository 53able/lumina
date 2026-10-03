/**
 * @vitest-environment jsdom
 *
 * ホーム（App）での API利用OFF の検証（Issue #29）
 * - 詳細パネルで未要約論文を開いても自動要約の summary リクエストが発生しない
 * - AI検索（入力・URL の ?q= 直開き）は検索 API を呼ばず、保存済み論文の一覧を残したまま停止理由を通知する
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";
import { useSummaryStore } from "./stores/summaryStore";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

const mockPapers = vi.hoisted(() => [
  {
    id: "2401.00001",
    title: "Test Paper Title",
    abstract: "This is a test abstract for the paper.",
    authors: ["Author One"],
    categories: ["cs.AI"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding: [0.1, 0.2],
  },
]);

vi.mock("@/client/stores/paperStore", () => ({
  usePaperStore: Object.assign(
    vi.fn((selector?: (s: unknown) => unknown) => {
      const state = { papers: mockPapers, isLoading: false, addPapers: vi.fn() };
      return selector ? selector(state) : state;
    }),
    { getState: () => ({ papers: mockPapers }) }
  ),
}));

vi.mock("@/client/stores/interactionStore", () => ({
  useInteractionStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      toggleLike: vi.fn(),
      toggleBookmark: vi.fn(),
      getLikedPaperIds: () => new Set<string>(),
      getBookmarkedPaperIds: () => new Set<string>(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      histories: [],
      getRecentHistories: () => [],
      addHistory: vi.fn(),
      deleteHistory: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

const fetchMock = vi.fn();

/** OFF で止まった検索の通知見出し */
const STOPPED_SEARCH_TITLE = "検索停止中: 保存済みの論文を表示しています";

/** fetch に渡された URL のうち、指定パスを含むものの件数 */
const countRequests = (path: string): number =>
  fetchMock.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes(path);
  }).length;

const renderApp = (initialEntry = "/") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/** 未要約論文を詳細パネルで開く */
const openPaperDetail = async () => {
  const user = userEvent.setup();
  await user.click(await screen.findByText("Test Paper Title"));
  await screen.findAllByText("This is a test abstract for the paper.");
};

describe("App: API利用OFF", () => {
  beforeEach(() => {
    toastError.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = url.includes("/api/v1/summary/")
        ? {
            paperId: "2401.00001",
            summary: "要約",
            keyPoints: [],
            language: "ja",
            createdAt: "2024-01-01T00:00:00.000Z",
          }
        : { papers: [], fetchedCount: 0, totalResults: 0, took: 0 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    // 自動同期を走らせない
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString() });
    useSummaryStore.setState({ summaries: [], addSummary: vi.fn(async () => {}) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("前提: 自動要約ON・API利用ONなら詳細パネルで未要約論文を開くと summary リクエストが発生する", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: true });
    renderApp();

    await openPaperDetail();

    await waitFor(() => expect(countRequests("/api/v1/summary/")).toBe(1));
  });

  // 自動要約の抑止（&& apiEnabled）は toast.error の有無で検証する。
  // 抑止がなくても summaryApi の実行境界で fetch は 0 件になるが、発火すれば「AI要約を停止中」のトーストが出る
  it("自動要約ONのままAPI利用をOFFにすると、詳細パネルで未要約論文を開いても自動要約が発火しない（fetch 0件・トーストなし）", async () => {
    useSettingsStore.setState({ autoGenerateSummary: true, apiEnabled: false });
    renderApp();

    await openPaperDetail();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(countRequests("/api/v1/summary/")).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("OFF中に検索しても検索APIを呼ばず、保存済み論文の一覧を残して停止理由を通知する", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        STOPPED_SEARCH_TITLE,
        expect.objectContaining({ description: expect.stringContaining("API利用がOFF") })
      )
    );
    expect(countRequests("/api/v1/search")).toBe(0);
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
  });

  it("OFFで検索が止まった後に検索欄を編集しても、保存済み論文の一覧が残る", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    const user = userEvent.setup();
    renderApp();

    const searchbox = await screen.findByRole("searchbox");
    await user.type(searchbox, "transformer{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalled());

    // 確定していない入力の変更（1文字追加・削除）
    await user.type(searchbox, "s");
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
    await user.type(searchbox, "{Backspace}{Backspace}");
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
    expect(countRequests("/api/v1/search")).toBe(0);
  });

  it("OFF中に ?q= で直接開いても検索APIを呼ばず、保存済み論文の一覧を残して停止理由を通知する", async () => {
    useSettingsStore.setState({ apiEnabled: false });
    renderApp("/?q=transformer");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(STOPPED_SEARCH_TITLE, expect.anything())
    );
    expect(countRequests("/api/v1/search")).toBe(0);
    expect(screen.getByText("Test Paper Title")).toBeInTheDocument();
  });
});

describe("App: 検索文の確認・編集（#31, #72）", () => {
  const searchBody = (searchText: string) => ({
    results: [],
    expandedQuery: {
      original: "transformer",
      english: "transformer",
      synonyms: ["attention mechanism", "self-attention"],
      searchText,
    },
    queryEmbedding: [0.1, 0.2],
    took: 1,
  });

  beforeEach(() => {
    toastError.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/v1/search")) {
        const request = JSON.parse(String(init?.body ?? "{}")) as { embeddingText?: string };
        return new Response(
          // クエリ拡張（AI）の検索文は関連語を言い換えて含む（関連語と完全一致しない）
          JSON.stringify(searchBody(request.embeddingText ?? "transformer attention models")),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ papers: [], fetchedCount: 0, totalResults: 0, took: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** 検索して検索文エディタを開く */
  const searchAndOpenEditor = async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
    await user.click(await screen.findByText("AIが検索に使った言葉を確認・調整"));
    await user.click(screen.getByText("検索文を直接編集する"));
    const textarea = screen.getByRole("textbox", {
      name: /検索文を直接編集/,
    }) as HTMLTextAreaElement;
    return { user, textarea };
  };

  /** search リクエストの body */
  const searchRequestBodies = () =>
    fetchMock.mock.calls
      .filter(([input]) =>
        String(input instanceof Request ? input.url : input).includes("/api/v1/search")
      )
      .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")));

  it("関連語のチェックを外して再検索すると、表示した「検索に使う文」が embeddingText として送られる", async () => {
    const { user, textarea } = await searchAndOpenEditor();
    expect(textarea.value).toBe("transformer attention models");

    await user.click(screen.getByRole("checkbox", { name: "attention mechanism" }));
    const finalText = screen.getByRole("status", { name: /^検索に使う文/ }).textContent;
    expect(finalText).toBe("transformer self-attention");
    await user.click(screen.getByRole("button", { name: "この検索文で再検索" }));

    await waitFor(() => expect(screen.getByText("検索文を編集済み")).toBeInTheDocument());
    expect(searchRequestBodies()).toEqual([
      { query: "transformer", limit: 20 },
      { query: "transformer", limit: 20, embeddingText: finalText },
    ]);
    // 選択を外した関連語だけを見出しで除外と示す
    expect(
      screen.getByText("attention mechanism", { selector: ".line-through" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("self-attention", { selector: ".line-through" })
    ).not.toBeInTheDocument();
    // 再検索後も同じ選択を復元する（外した語を再追加しない）
    expect(screen.getByRole("checkbox", { name: "attention mechanism" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "self-attention" })).toBeChecked();
    // 元の入力は保持する
    expect(screen.getByRole("searchbox")).toHaveValue("transformer");
  });

  it("自由編集した文で再検索すると、その文が embeddingText として送られ、関連語を除外と表示しない", async () => {
    const { user, textarea } = await searchAndOpenEditor();

    await user.clear(textarea);
    await user.type(textarea, "transformer attention");
    expect(screen.getByText(/自由編集中（関連語の選択は無効）/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "この検索文で再検索" }));

    await waitFor(() => expect(screen.getByText("検索文を編集済み")).toBeInTheDocument());
    expect(searchRequestBodies()[1]).toEqual({
      query: "transformer",
      limit: 20,
      embeddingText: "transformer attention",
    });
    // "attention mechanism" と完全一致しなくても削除済みのように表示しない
    expect(screen.queryByText("（除外）", { exact: false })).not.toBeInTheDocument();
    // 手動修正を保ったまま自由編集中として開く
    expect(screen.getByText(/自由編集中（関連語の選択は無効）/)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /^検索に使う文/ })).toHaveTextContent(
      "transformer attention"
    );
  });

  it("API利用OFFにすると編集文で再検索できず、fetch は増えない", async () => {
    const { user, textarea } = await searchAndOpenEditor();
    expect(countRequests("/api/v1/search")).toBe(1);

    act(() => {
      useSettingsStore.setState({ apiEnabled: false });
    });
    await user.clear(textarea);
    await user.type(textarea, "transformer");
    const button = screen.getByRole("button", { name: "この検索文で再検索" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/API利用OFFのため再検索を停止中/);
    // ボタンを経由しない送信（Enter 等）でも送らない
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(countRequests("/api/v1/search")).toBe(1);
  });
});
