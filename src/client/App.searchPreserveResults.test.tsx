/**
 * @vitest-environment jsdom
 *
 * 検索中・失敗時に入力と前回の結果を保持し、状態と復旧操作を検索欄の近くに示す（Issue #71）
 * 本物の App を描画し、検索API（fetch）の遅延・失敗を注入して画面の挙動で確かめる。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => true,
}));

const mockPapers = vi.hoisted(() => [
  {
    id: "2401.00001",
    title: "Previous Result Paper",
    abstract: "abstract",
    authors: ["Author One"],
    categories: ["cs.AI"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding: [0.1, 0.2],
  },
]);

vi.mock("@/client/stores/paperStore", async () => {
  const { createPaperEmbeddingIndex } = await import("./lib/paperIndex/core");
  return {
    usePaperStore: Object.assign(
      vi.fn((selector?: (s: unknown) => unknown) => {
        const state = {
          papers: mockPapers,
          isLoading: false,
          loadStatus: "ready",
          addPapers: vi.fn(),
        };
        return selector ? selector(state) : state;
      }),
      { getState: () => ({ papers: mockPapers, loadStatus: "ready" }) }
    ),
    whenPapersReady: () => Promise.resolve(),
    // 保存済み論文は全件準備済みとして、mockPapers を索引で検索する
    paperStoreSearchSource: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      search: async (queryEmbedding: number[], scoreThreshold: number, limit: number) => {
        const index = createPaperEmbeddingIndex();
        index.upsert(mockPapers);
        return index.search(queryEmbedding, scoreThreshold, limit);
      },
    },
  };
});

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

const addHistory = vi.hoisted(() => vi.fn(async (_history: { originalQuery: string }) => {}));
const searchHistoryState = vi.hoisted(() => ({
  histories: [],
  getRecentHistories: () => [],
  addHistory,
  deleteHistory: async () => {},
}));
vi.mock("@/client/stores/searchHistoryStore", () => ({
  useSearchHistoryStore: vi.fn((selector?: (s: unknown) => unknown) =>
    selector ? selector(searchHistoryState) : searchHistoryState
  ),
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** 検索の成功応答。embedding が論文と同じなら1件、逆向きなら0件になる */
const searchSuccess = (query: string, embedding = [0.1, 0.2]) =>
  jsonResponse({
    results: [],
    expandedQuery: { original: query, english: query, synonyms: [], searchText: query },
    queryEmbedding: embedding,
    took: 1,
  });

const emptySyncResponse = () =>
  jsonResponse({ papers: [], fetchedCount: 0, totalResults: 0, took: 0 });

const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

/** 検索APIへの応答（呼び出し順に1つずつ使う。足りなければ成功応答） */
type SearchHandler = (query: string, signal: AbortSignal | undefined) => Promise<Response>;
let searchHandlers: SearchHandler[] = [];
const fetchMock = vi.fn();
const searchCalls = () =>
  fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes("/api/v1/search"));

/**
 * 応答を外から返せる検索（遅延の注入用）。
 * 通信の中止に関わらず応答を届けられるようにし（中止前に届いた応答・中止に従わない経路の再現）、
 * 応答の採用可否が中止・後続検索で正しく判定されるかを確かめる。
 */
const holdSearch = () => {
  let respond!: (response: Response) => void;
  let receivedSignal: AbortSignal | undefined;
  const handler: SearchHandler = (_query, signal) => {
    receivedSignal = signal;
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  };
  return {
    handler,
    respond: (response: Response) => respond(response),
    isAborted: () => receivedSignal?.aborted === true,
  };
};

const LocationSearch = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderApp = (initialEntry = "/") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InteractionProvider>
          <App />
          <LocationSearch />
        </InteractionProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/** 検索欄の近くに出る失敗の表示（role="alert"） */
const findFailureAlert = async () =>
  (await screen.findByText(/を検索できませんでした/)).closest('[role="alert"]') as HTMLElement;

const getLocationSearch = () => screen.getByTestId("location-search").textContent;
const heading = () => screen.getByRole("heading", { level: 2 });

/** ?q=A の検索を完了させ、前回の結果（1件）がある状態にする */
const renderWithPreviousResult = async () => {
  renderApp("/?q=A");
  await waitFor(() => expect(heading()).toHaveTextContent('"A" の検索結果'));
  expect(screen.getByText(/件の論文/)).toHaveTextContent("1件の論文");
  expect(addHistory).toHaveBeenCalledTimes(1);
};

/** 検索欄の入力を B に置き換えて検索する */
const searchB = async (user: ReturnType<typeof userEvent.setup>) => {
  const searchbox = screen.getByRole("searchbox");
  await user.clear(searchbox);
  await user.type(searchbox, "B{Enter}");
};

/** 前回の結果（A）を表示したまま、B の検索中・失敗であることを示しているか */
const expectPreviousResultKept = () => {
  expect(heading()).toHaveTextContent('前回の結果（"A"）');
  expect(heading()).not.toHaveTextContent("の検索結果");
  expect(screen.getByText("Previous Result Paper")).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("B");
};

describe("App: 検索中・失敗時に入力と前回の結果を保持する（#71）", () => {
  beforeAll(() => {
    Element.prototype.scrollTo ??= () => {};
  });

  beforeEach(() => {
    searchHandlers = [];
    addHistory.mockClear();
    toastError.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!requestUrl(input).includes("/api/v1/search")) return emptySyncResponse();
      const rawBody = input instanceof Request ? await input.clone().text() : String(init?.body);
      const { query } = JSON.parse(rawBody) as { query: string };
      const signal = input instanceof Request ? input.signal : (init?.signal ?? undefined);
      const handler = searchHandlers.shift();
      return handler ? handler(query, signal) : searchSuccess(query);
    });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("検索中は入力と前回の結果を残し、「前回の結果」と新しい検索の実行中を区別する", async () => {
    await renderWithPreviousResult();
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    const user = userEvent.setup();

    await searchB(user);

    await waitFor(() => expect(screen.getByText(/「B」を検索中/)).toBeInTheDocument());
    expectPreviousResultKept();
    expect(screen.getByText(/「B」を検索中/)).toHaveTextContent('表示中は前回の結果（"A"）です');
    // 前回の結果の件数・しきい値の操作は新しい検索の結果として出さない
    expect(screen.queryByText(/件の論文/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("paper-list-loading")).not.toBeInTheDocument();
    expect(getLocationSearch()).toBe("?q=B");

    await act(async () => {
      pending.respond(searchSuccess("B", [-0.1, -0.2]));
    });

    // 新しい検索の成功（0件）は前回の結果と区別して表示する
    await waitFor(() => expect(heading()).toHaveTextContent('"B" の検索結果'));
    expect(screen.queryByText("Previous Result Paper")).not.toBeInTheDocument();
    expect(screen.getByText(/類似度がしきい値/)).toBeInTheDocument();
    expect(addHistory).toHaveBeenCalledTimes(2);
    expect(addHistory.mock.calls[1]?.[0].originalQuery).toBe("B");
  });

  it("検索中はキーボードで中止でき、前回の結果に戻る。後から届いた応答は表示・履歴・URLを上書きしない", async () => {
    await renderWithPreviousResult();
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    const user = userEvent.setup();

    await searchB(user);

    // 検索中もフォーカスは検索欄に残り（自動では動かさない）、中止ボタンへは Tab で届く
    const cancelButton = await screen.findByRole("button", { name: "中止して前回の結果に戻る" });
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "検索" })).toHaveFocus();
    await user.tab();
    expect(cancelButton).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(heading()).toHaveTextContent('"A" の検索結果'));
    expect(getLocationSearch()).toBe("?q=A");
    expect(screen.getByText("Previous Result Paper")).toBeInTheDocument();
    // 入力は消さず、検索欄に戻る
    const searchbox = screen.getByRole("searchbox");
    expect(searchbox).not.toHaveAttribute("aria-disabled");
    expect(searchbox).toHaveValue("B");
    expect(searchbox).toHaveFocus();
    expect(screen.queryByText(/を検索中/)).not.toBeInTheDocument();
    expect(pending.isAborted()).toBe(true);

    // 中止した検索の応答が後から届いても採用しない
    await act(async () => {
      pending.respond(searchSuccess("B", [-0.1, -0.2]));
    });
    expect(heading()).toHaveTextContent('"A" の検索結果');
    expect(screen.getByText("Previous Result Paper")).toBeInTheDocument();
    expect(getLocationSearch()).toBe("?q=A");
    expect(addHistory).toHaveBeenCalledTimes(1);
    // URL を前回のクエリに戻しても再検索しない（1操作1実行）
    expect(searchCalls()).toHaveLength(2);
  });

  it("前回の結果がない検索を中止すると、検索していない状態に戻り入力は残る", async () => {
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByRole("searchbox"), "B{Enter}");
    await user.click(await screen.findByRole("button", { name: "検索を中止" }));

    await waitFor(() => expect(heading()).toHaveTextContent("論文を探す"));
    expect(getLocationSearch()).toBe("");
    expect(screen.getByRole("searchbox")).toHaveValue("B");
    expect(searchCalls()).toHaveLength(1);
  });

  describe.each([
    {
      label: "401（認証）",
      inject: () => jsonResponse({ error: "Incorrect API key provided: sk-xxxx" }, 401),
      reason: "APIキーが無効か、権限がありません",
      canRetry: false,
      suggestSettings: true,
    },
    {
      label: "403（権限なし）",
      inject: () => jsonResponse({ error: "forbidden sk-xxxx" }, 403),
      reason: "APIキーが無効か、権限がありません",
      canRetry: false,
      suggestSettings: true,
    },
    {
      label: "429（プレーンテキストの上限）",
      inject: () => new Response("Too many requests, please try again later.", { status: 429 }),
      reason: "検索の利用上限に達しました",
      canRetry: true,
      suggestSettings: false,
    },
    {
      label: "500（上流のエラー）",
      inject: () => jsonResponse({ error: "upstream secret detail" }, 500),
      // サーバーは上流の認証・上限の失敗も 500 で返すため、設定の確認も案内する
      reason: "時間をおいて再試行するか、設定でAPIキーを確認してください",
      canRetry: true,
      suggestSettings: true,
    },
    {
      label: "タイムアウト・通信失敗",
      inject: () => Promise.reject(new TypeError("Failed to fetch")),
      reason: "通信状況を確認して再試行してください",
      canRetry: true,
      suggestSettings: false,
    },
  ])("API拒否・失敗の注入: $label", ({ inject, reason, canRetry, suggestSettings }) => {
    it("入力と前回の結果を失わず、理由を検索欄の近くに残し、自動では再試行しない", async () => {
      await renderWithPreviousResult();
      searchHandlers.push(() => Promise.resolve().then(inject));
      const user = userEvent.setup();

      await searchB(user);

      const alert = await findFailureAlert();
      expect(alert).toHaveTextContent("「B」を検索できませんでした");
      expect(alert).toHaveTextContent(reason);
      expect(alert).toHaveTextContent('表示中は前回の結果（"A"）です');
      // 上流のエラー文は画面に出さない
      expect(alert).not.toHaveTextContent("sk-xxxx");
      expect(alert).not.toHaveTextContent("upstream secret detail");
      expectPreviousResultKept();
      expect(screen.getByRole("searchbox")).not.toHaveAttribute("aria-disabled");
      // 「同じ条件で再試行」は設定を直さない限り失敗する分類では出さない
      expect(screen.queryByRole("button", { name: "同じ条件で再試行" }) !== null).toBe(canRetry);
      expect(screen.queryByRole("button", { name: "設定を開く" }) !== null).toBe(suggestSettings);
      expect(screen.getByRole("button", { name: "条件を編集" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "前結果を見る" })).toBeInTheDocument();

      // 待っても自動で再試行しない。失敗した検索は履歴に残さない
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(searchCalls()).toHaveLength(2);
      expect(addHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("API利用OFFで止まっても、入力と前回の結果を残し、再試行ではなく設定を案内する", async () => {
    await renderWithPreviousResult();
    const user = userEvent.setup();
    act(() => {
      useSettingsStore.setState({ apiEnabled: false });
    });

    await searchB(user);

    const alert = await findFailureAlert();
    expect(alert).toHaveTextContent("API利用がOFF");
    expectPreviousResultKept();
    expect(screen.queryByRole("button", { name: "同じ条件で再試行" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定を開く" })).toBeInTheDocument();
    // 前回の結果を表示しているので「保存済みの論文を表示しています」とは通知しない
    expect(toastError).not.toHaveBeenCalled();
    expect(searchCalls()).toHaveLength(1);
  });

  it("失敗後はキーボードで同じ条件の再試行（1操作1回）・条件の編集・前結果の表示を区別して操作できる", async () => {
    await renderWithPreviousResult();
    searchHandlers.push(
      () => Promise.resolve(jsonResponse({ error: "x" }, 500)),
      () => Promise.resolve(jsonResponse({ error: "x" }, 500))
    );
    const user = userEvent.setup();

    await searchB(user);
    const alert = await findFailureAlert();
    const panel = alert.parentElement as HTMLElement;

    // 条件を編集: 検索欄に戻り、失敗した入力のまま直せる
    within(panel).getByRole("button", { name: "条件を編集" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("B");

    // 同じ条件で再試行: 1回の操作で検索APIを1回だけ呼ぶ
    screen.getByRole("button", { name: "同じ条件で再試行" }).focus();
    await user.keyboard("{Enter}");
    // 押したボタンは消えるため、フォーカスは検索欄へ戻る（body に落ちない）
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await findFailureAlert();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(searchCalls()).toHaveLength(3);
    const [, retryInit] = searchCalls()[2] as [RequestInfo | URL, RequestInit | undefined];
    const retryInput = searchCalls()[2]?.[0];
    const retryBody =
      retryInput instanceof Request ? await retryInput.clone().text() : String(retryInit?.body);
    expect(JSON.parse(retryBody)).toMatchObject({ query: "B" });
    expectPreviousResultKept();

    // 前結果を見る: 失敗した検索をやめて前回の結果の検索に戻る
    screen.getByRole("button", { name: "前結果を見る" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(heading()).toHaveTextContent('"A" の検索結果'));
    expect(screen.queryByText(/を検索できませんでした/)).not.toBeInTheDocument();
    expect(getLocationSearch()).toBe("?q=A");
    expect(screen.getByRole("searchbox")).toHaveValue("B");
    expect(searchCalls()).toHaveLength(3);
    expect(addHistory).toHaveBeenCalledTimes(1);
  });

  it("再試行が成功すると、新しい検索の結果として表示し履歴に残す", async () => {
    await renderWithPreviousResult();
    searchHandlers.push(() => Promise.resolve(jsonResponse({ error: "x" }, 500)));
    const user = userEvent.setup();

    await searchB(user);
    await user.click(await screen.findByRole("button", { name: "同じ条件で再試行" }));

    await waitFor(() => expect(heading()).toHaveTextContent('"B" の検索結果'));
    expect(screen.queryByText(/を検索できませんでした/)).not.toBeInTheDocument();
    expect(screen.getByText(/件の論文/)).toHaveTextContent("1件の論文");
    expect(searchCalls()).toHaveLength(3);
    expect(addHistory).toHaveBeenCalledTimes(2);
    expect(addHistory.mock.calls[1]?.[0].originalQuery).toBe("B");
  });

  it("中止後に別の検索が完了してから中止した検索の応答が届いても、表示・URL・履歴を上書きしない", async () => {
    await renderWithPreviousResult();
    const slow = holdSearch();
    searchHandlers.push(slow.handler);
    const user = userEvent.setup();

    await searchB(user);
    await user.click(await screen.findByRole("button", { name: "中止して前回の結果に戻る" }));
    await waitFor(() => expect(heading()).toHaveTextContent('"A" の検索結果'));

    const searchbox = screen.getByRole("searchbox");
    await user.clear(searchbox);
    await user.type(searchbox, "C{Enter}");
    await waitFor(() => expect(heading()).toHaveTextContent('"C" の検索結果'));

    await act(async () => {
      slow.respond(searchSuccess("B", [-0.1, -0.2]));
    });
    expect(heading()).toHaveTextContent('"C" の検索結果');
    expect(getLocationSearch()).toBe("?q=C");
    expect(addHistory.mock.calls.map(([h]) => h.originalQuery)).toEqual(["A", "C"]);
  });

  it("URL を直接開いた検索では、検索中も完了後もフォーカスを動かさない", async () => {
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    renderApp("/?q=A");

    await screen.findByRole("button", { name: "検索を中止" });
    expect(document.activeElement).toBe(document.body);

    await act(async () => {
      pending.respond(searchSuccess("A"));
    });
    await waitFor(() => expect(heading()).toHaveTextContent('"A" の検索結果'));
    expect(document.activeElement).toBe(document.body);
  });

  it("入力から検索すると、検索中も成功後もフォーカスは検索欄に残る（body に落ちない）", async () => {
    await renderWithPreviousResult();
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    const user = userEvent.setup();

    await searchB(user);
    await screen.findByText(/「B」を検索中/);
    const searchbox = screen.getByRole("searchbox");
    expect(searchbox).toHaveFocus();
    // ブラウザは disabled にした要素のフォーカスを外す（jsdom は外さない）ため、disabled にしていないことを確かめる
    expect(searchbox).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "検索" })).not.toBeDisabled();
    expect(searchbox).toHaveAttribute("aria-disabled", "true");

    // 検索中の Enter は二重に送信しない
    await user.keyboard("{Enter}");
    expect(searchCalls()).toHaveLength(2);

    await act(async () => {
      pending.respond(searchSuccess("B"));
    });
    await waitFor(() => expect(heading()).toHaveTextContent('"B" の検索結果'));
    expect(searchbox).toHaveFocus();
    expect(searchbox).not.toHaveAttribute("aria-disabled");
  });

  it("中止と同時にしきい値が更新されても、中止した検索も前回の検索もやり直さない（#81 と同型）", async () => {
    await renderWithPreviousResult();
    const pending = holdSearch();
    searchHandlers.push(pending.handler);
    const user = userEvent.setup();

    await searchB(user);
    const cancelButton = await screen.findByRole("button", { name: "中止して前回の結果に戻る" });
    act(() => {
      cancelButton.click();
      useSettingsStore.getState().setSearchScoreThreshold(0.5);
    });

    await waitFor(() => expect(getLocationSearch()).toBe("?q=A"));
    expect(heading()).toHaveTextContent('"A" の検索結果');
    expect(searchCalls()).toHaveLength(2);
    expect(addHistory).toHaveBeenCalledTimes(1);
  });
});
