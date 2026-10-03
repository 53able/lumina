/**
 * @vitest-environment jsdom
 *
 * ホーム（App）で検索結果の横から類似度しきい値を調整する検証（Issue #53）
 * - しきい値の変更が表示中の検索結果に即時反映され、検索APIを呼び直さない
 * - 設定ダイアログのしきい値と同じ値を共有する
 * - スライダーにアクセシブルネームと値の読み上げがあり、調整後の件数を live region で通知する
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

/** クエリEmbedding [1, 0] とのコサイン類似度: Near=1.0 / Mid≈0.71 / Far=0 */
const mockPapers = vi.hoisted(() =>
  (
    [
      ["2401.00001", "Near Paper", [1, 0]],
      ["2401.00002", "Mid Paper", [1, 1]],
      ["2401.00003", "Far Paper", [0, 1]],
    ] as const
  ).map(([id, title, embedding]) => ({
    id,
    title,
    abstract: `Abstract of ${title}.`,
    authors: ["Author One"],
    categories: ["cs.AI"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    embedding: [...embedding],
  }))
);

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

const addHistory = vi.hoisted(() => vi.fn());
vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      histories: [],
      getRecentHistories: () => [],
      addHistory,
      deleteHistory: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

const fetchMock = vi.fn();

/** 検索APIの呼び出し回数 */
const countSearchRequests = (): number =>
  fetchMock.mock.calls.filter(([input]) =>
    String(input instanceof Request ? input.url : input).includes("/api/v1/search")
  ).length;

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/** 検索して結果（しきい値の操作部）が表示されるまで待つ */
const searchTransformer = async () => {
  const user = userEvent.setup();
  renderApp();
  await user.type(await screen.findByRole("searchbox"), "transformer{Enter}");
  const slider = await screen.findByRole("slider", { name: "類似度のしきい値" });
  await screen.findByText("Mid Paper");
  return { user, slider: slider as HTMLInputElement };
};

describe("App: 検索結果の横でしきい値を調整する（#53）", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    addHistory.mockClear();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = url.includes("/api/v1/search")
        ? {
            results: [],
            expandedQuery: {
              original: "transformer",
              english: "transformer",
              synonyms: [],
              searchText: "transformer",
            },
            queryEmbedding: [1, 0],
            took: 1,
          }
        : { papers: [], fetchedCount: 0, totalResults: 0, took: 0 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("しきい値を上げ下げすると結果が即時に変わり、検索APIの呼び出しと履歴追加は増えない", async () => {
    const { slider } = await searchTransformer();
    // 既定 0.30: Near・Mid が該当し、Far は該当しない
    expect(screen.getByText("Near Paper")).toBeInTheDocument();
    expect(screen.queryByText("Far Paper")).not.toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
    const historyCalls = addHistory.mock.calls.length;

    fireEvent.change(slider, { target: { value: "0.8" } });
    await waitFor(() => expect(screen.queryByText("Mid Paper")).not.toBeInTheDocument());
    expect(screen.getByText("Near Paper")).toBeInTheDocument();

    // 値を戻すと同じ結果に戻る
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(await screen.findByText("Mid Paper")).toBeInTheDocument();

    expect(countSearchRequests()).toBe(1);
    expect(addHistory.mock.calls.length).toBe(historyCalls);
  });

  it("調整後の表示件数を live region で通知する（調整前は通知しない）", async () => {
    const { slider } = await searchTransformer();
    const status = screen
      .getAllByRole("status")
      .find((el) => el.closest("div")?.contains(slider)) as HTMLElement;
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");

    fireEvent.change(slider, { target: { value: "0.8" } });
    await waitFor(() => expect(status).toHaveTextContent("1件を表示"));
  });

  it("スライダーはキーボードでフォーカスでき、0〜1・0.05刻みで現在値を読み上げる", async () => {
    const { slider } = await searchTransformer();
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1");
    expect(slider).toHaveAttribute("step", "0.05");
    expect(slider).toHaveAttribute("aria-valuetext", "0.30");

    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: "0.35" } });
    expect(slider).toHaveAttribute("aria-valuetext", "0.35");
  });

  it("設定ダイアログのしきい値と同じ値を共有し、ダイアログでの変更も表示中の結果に反映される", async () => {
    const { user, slider } = await searchTransformer();
    fireEvent.change(slider, { target: { value: "0.8" } });

    await user.click(screen.getByRole("button", { name: "設定" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "検索" }));
    const dialogSlider = within(dialog).getByRole("slider", { name: "類似度のしきい値" });
    expect(dialogSlider).toHaveValue("0.8");
    expect(within(dialog).queryByText(/再検索まで反映されません/)).not.toBeInTheDocument();

    fireEvent.change(dialogSlider, { target: { value: "0" } });
    expect(useSettingsStore.getState().searchScoreThreshold).toBe(0);
    expect(slider).toHaveValue("0");
    await waitFor(() => expect(screen.getByText("Far Paper")).toBeInTheDocument());
    expect(countSearchRequests()).toBe(1);
  });
});
