/**
 * @vitest-environment jsdom
 *
 * ホーム（App）で検索結果の件数の隣から類似度しきい値を調整する検証（Issue #53）
 * - しきい値の変更が表示中の検索結果に即時反映され、検索APIを呼び直さない
 * - 設定ダイアログのしきい値と同じ値を共有する
 * - 件数の隣の開閉トグル（モバイルは既定で閉じる）、アクセシブルネーム・値の読み上げ
 * - 調整後の件数を、画面の「N件の論文」と同じ値で live region に通知する
 * - しきい値で0件になったときは、しきい値を下げる案内を出す
 * - クエリEmbeddingがない検索ではスライダーを無効にして理由を出す
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../shared/schemas/index";
import { App } from "./App";
// App が lazy() で読み込むコンポーネントを先に読み込む（初回描画時の動的読み込みを先頭テストの testTimeout に含めない）
import "./components/PaperDetail";
import "./components/SettingsDialog";
import { InteractionProvider } from "./contexts/InteractionContext";
import { useSettingsStore } from "./stores/settingsStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

/** テスト用の論文（embedding が null のものは検索対象外） */
const createPaper = (
  id: string,
  title: string,
  embedding: number[] | null,
  categories: string[] = ["cs.AI"]
) => ({
  id,
  title,
  abstract: `Abstract of ${title}.`,
  authors: ["Author One"],
  categories,
  publishedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-02"),
  pdfUrl: `https://arxiv.org/pdf/${id}`,
  arxivUrl: `https://arxiv.org/abs/${id}`,
  ...(embedding ? { embedding } : {}),
});

/** クエリEmbedding [1, 0] とのコサイン類似度: Near≈1.0 / Mid≈0.71 / Far=0。NoEmbedding は検索対象外 */
const NEAR = createPaper("2401.00001", "Near Paper", [1, 0.01]);
const MID = createPaper("2401.00002", "Mid Paper", [1, 1]);
const FAR = createPaper("2401.00003", "Far Paper", [0, 1]);
const NO_EMBEDDING = createPaper("2401.00004", "NoEmbedding Paper", null);

const paperState = vi.hoisted(() => ({ papers: [] as unknown[] }));

vi.mock("@/client/stores/paperStore", async () => {
  const { createPaperEmbeddingIndex } = await import("./lib/paperIndex/core");
  return {
    usePaperStore: Object.assign(
      vi.fn((selector?: (s: unknown) => unknown) => {
        const state = {
          papers: paperState.papers,
          isLoading: false,
          loadStatus: "ready",
          addPapers: vi.fn(),
        };
        return selector ? selector(state) : state;
      }),
      { getState: () => ({ papers: paperState.papers, loadStatus: "ready" }) }
    ),
    whenPapersReady: () => Promise.resolve(),
    // 保存済み論文は全件準備済みとして、その時点の paperState.papers を索引で検索する
    paperStoreSearchSource: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      search: async (queryEmbedding: number[], scoreThreshold: number, limit: number) => {
        const index = createPaperEmbeddingIndex();
        index.upsert(paperState.papers as Paper[]);
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

/** 検索APIの応答を返す fetch を設定する（withEmbedding=false はクエリEmbeddingなし） */
const mockFetch = ({ withEmbedding }: { withEmbedding: boolean }) => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    let body: unknown = { papers: [], fetchedCount: 0, totalResults: 0, took: 0 };
    if (url.includes("/api/v1/search")) {
      const { query } = JSON.parse(String(init?.body ?? "{}")) as { query: string };
      body = {
        results: [],
        expandedQuery: { original: query, english: query, synonyms: [], searchText: query },
        ...(withEmbedding ? { queryEmbedding: [1, 0] } : {}),
        took: 1,
      };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
};

/** デスクトップ幅（lg 以上）として描画する */
const useDesktopViewport = () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    ...original(query),
    matches: query === "(min-width: 1024px)",
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
};

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

/** しきい値の開閉トグル */
const getToggle = () => screen.getByRole("button", { name: /^しきい値/ });

/** 調整結果の live region */
const getAnnouncer = () => screen.getByRole("status", { name: "しきい値の調整結果" });

/** 一覧の件数表示（「N件の論文」）の N */
const getDisplayedCount = () => {
  const label = screen.getByText("件の論文");
  return label.querySelector("span")?.textContent ?? "";
};

/** 検索して、件数の隣のトグルが出るまで待つ */
const search = async (query = "transformer") => {
  const user = userEvent.setup();
  renderApp();
  await user.type(await screen.findByRole("searchbox"), `${query}{Enter}`);
  await screen.findByRole("button", { name: /^しきい値/ });
  return user;
};

/** トグルを開いてスライダーを返す */
const openSlider = async (user: ReturnType<typeof userEvent.setup>) => {
  if (getToggle().getAttribute("aria-expanded") !== "true") {
    await user.click(getToggle());
  }
  return screen.getByRole("slider", { name: "類似度のしきい値" }) as HTMLInputElement;
};

describe("App: 検索結果の件数の隣でしきい値を調整する（#53）", () => {
  beforeAll(() => {
    // jsdom は Element#scrollTo を実装していない（0件から一覧に戻るときに呼ばれる）
    Element.prototype.scrollTo ??= () => {};
  });

  beforeEach(() => {
    paperState.papers = [NEAR, MID, FAR, NO_EMBEDDING];
    fetchMock.mockReset();
    addHistory.mockClear();
    mockFetch({ withEmbedding: true });
    vi.stubGlobal("fetch", fetchMock);
    useSettingsStore.getState().resetAllSettings();
    useSettingsStore.setState({ lastSyncedAt: new Date().toISOString(), apiEnabled: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("モバイルではトグルが既定で閉じ、開くと一覧を残したままスライダーが出る（キーボードで開ける）", async () => {
    const user = await search();
    const toggle = getToggle();
    expect(toggle).toHaveTextContent("しきい値 0.30");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole("slider", { name: "類似度のしきい値" })).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(screen.getByRole("slider", { name: "類似度のしきい値" })).toBeInTheDocument();
    expect(screen.getByText("Near Paper")).toBeInTheDocument();
  });

  it("デスクトップではトグルが既定で開いている", async () => {
    const restore = useDesktopViewport();
    try {
      await search();
      expect(getToggle()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("slider", { name: "類似度のしきい値" })).toBeVisible();
    } finally {
      restore();
    }
  });

  it("しきい値を上げ下げすると結果が即時に変わり、検索APIの呼び出しと履歴追加は増えない", async () => {
    const user = await search();
    const slider = await openSlider(user);
    // 既定 0.30: Near・Mid が該当し、Far は該当しない
    expect(screen.getByText("Mid Paper")).toBeInTheDocument();
    expect(screen.queryByText("Far Paper")).not.toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
    const historyCalls = addHistory.mock.calls.length;

    // 結果は保存済み論文の索引（Web Worker）で再計算するため、反映は非同期（検索APIは呼ばない）
    fireEvent.change(slider, { target: { value: "0.8" } });
    expect(getToggle()).toHaveTextContent("しきい値 0.80");
    await waitFor(() => expect(screen.queryByText("Mid Paper")).not.toBeInTheDocument());
    expect(screen.getByText("Near Paper")).toBeInTheDocument();

    // 値を戻すと同じ結果に戻る
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(await screen.findByText("Mid Paper")).toBeInTheDocument();

    expect(countSearchRequests()).toBe(1);
    expect(addHistory.mock.calls.length).toBe(historyCalls);
  });

  it("調整後、画面の「N件の論文」と同じ件数を操作が落ち着いてから live region で通知する", async () => {
    const user = await search();
    const slider = await openSlider(user);
    const announcer = getAnnouncer();
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("");

    fireEvent.change(slider, { target: { value: "0.8" } });
    // 画面の件数は検索結果（Near）と検索対象外（NoEmbedding）を合わせた2件（索引での再計算は非同期）
    await waitFor(() => expect(getDisplayedCount()).toBe("2"));
    // ドラッグ中に読み上げを連発しないよう、すぐには更新しない
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(announcer).toHaveTextContent("");
    await waitFor(() => expect(announcer).toHaveTextContent("しきい値 0.80: 2件の論文を表示"));
  });

  it("スライダーは 0〜1・0.05刻みでフォーカスでき、現在値を読み上げ、説明が関連付いている", async () => {
    const user = await search();
    const slider = await openSlider(user);
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1");
    expect(slider).toHaveAttribute("step", "0.05");
    expect(slider).toHaveAttribute("aria-valuetext", "0.30");
    expect(slider).toHaveAccessibleDescription(/再検索はしません/);

    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: "0.35" } });
    expect(slider).toHaveAttribute("aria-valuetext", "0.35");
  });

  it("設定ダイアログのしきい値と同じ値を共有し、ダイアログでの変更も表示中の結果に反映される", async () => {
    const user = await search();
    const slider = await openSlider(user);
    fireEvent.change(slider, { target: { value: "0.8" } });

    await user.click(screen.getByRole("button", { name: "設定" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "検索" }));
    const dialogSlider = within(dialog).getByRole("slider", { name: "類似度のしきい値" });
    expect(dialogSlider).toHaveValue("0.8");
    expect(within(dialog).queryByText(/再検索まで反映されません/)).not.toBeInTheDocument();
    expect(dialogSlider).toHaveAccessibleDescription(/再検索なしで反映されます/);

    fireEvent.change(dialogSlider, { target: { value: "0" } });
    expect(useSettingsStore.getState().searchScoreThreshold).toBe(0);
    expect(slider).toHaveValue("0");
    expect(await screen.findByText("Far Paper")).toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
  });

  it("しきい値で0件になったら、同期ではなくしきい値を下げる案内を出し、スライダーは操作できる", async () => {
    paperState.papers = [NEAR, MID, FAR];
    const user = await search();
    const slider = await openSlider(user);

    fireEvent.change(slider, { target: { value: "1" } });
    expect(
      await screen.findByText("類似度がしきい値 1.00 以上の論文はありません")
    ).toBeInTheDocument();
    expect(screen.queryByText(/Embeddingを補完/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "類似度のしきい値" }), {
      target: { value: "0.5" },
    });
    expect(await screen.findByText("Near Paper")).toBeInTheDocument();
    expect(countSearchRequests()).toBe(1);
  });

  it("しきい値が0で0件のときは、これ以上下げられないので下げる案内を出さない", async () => {
    // クエリと逆向きで類似度が負（-1）の論文だけ
    paperState.papers = [createPaper("2401.00005", "Opposite Paper", [-1, 0])];
    useSettingsStore.getState().setSearchScoreThreshold(0);
    await search();

    expect(
      await screen.findByText("類似度がしきい値 0.00 以上の論文はありません")
    ).toBeInTheDocument();
    expect(screen.queryByText(/しきい値を下げると/)).not.toBeInTheDocument();
  });

  it("絞り込みで0件のときは、しきい値の案内ではなく「条件に一致する論文がありません」を出す", async () => {
    const restore = useDesktopViewport();
    try {
      // 検索対象外の論文だけ別カテゴリ（cs.CL）にし、cs.AI で絞り込む
      paperState.papers = [
        NEAR,
        MID,
        createPaper("2401.00004", "NoEmbedding Paper", null, ["cs.CL"]),
      ];
      const user = await search();
      // デスクトップのカテゴリは折りたたみ領域（#68）。開いてから選ぶ
      await user.click(screen.getByRole("button", { name: /^カテゴリ/ }));
      await user.click(screen.getByRole("button", { name: /^cs\.AI / }));
      expect(screen.getByText("Mid Paper")).toBeInTheDocument();
      expect(screen.queryByText("NoEmbedding Paper")).not.toBeInTheDocument();

      // しきい値を最大にすると検索結果は0件。一覧には検索対象外（cs.CL）が残るが、cs.AI の絞り込みで0件になる
      fireEvent.change(screen.getByRole("slider", { name: "類似度のしきい値" }), {
        target: { value: "1" },
      });
      expect(await screen.findByText("条件に一致する論文がありません")).toBeInTheDocument();
      expect(screen.queryByText(/以上の論文はありません/)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("スライダー以外（設定ダイアログ）での件数の変化は通知しない", async () => {
    const user = await search();
    fireEvent.change(await openSlider(user), { target: { value: "0.8" } });
    const announcer = getAnnouncer();
    await waitFor(() => expect(announcer).toHaveTextContent("しきい値 0.80: 2件の論文を表示"));

    await user.click(screen.getByRole("button", { name: "設定" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "検索" }));
    fireEvent.change(within(dialog).getByRole("slider", { name: "類似度のしきい値" }), {
      target: { value: "0" },
    });
    expect(await screen.findByText("Far Paper")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(announcer).toHaveTextContent("しきい値 0.80: 2件の論文を表示");
  });

  it("モバイルの絞り込み操作としきい値操作は、それぞれの通知だけを1回ずつ鳴らし、二重に通知しない（#52）", async () => {
    // 検索結果（Near・Mid）と検索対象外（NoEmbedding）でカテゴリを分ける
    paperState.papers = [
      NEAR,
      createPaper("2401.00002", "Mid Paper", [1, 1], ["cs.LG"]),
      FAR,
      NO_EMBEDDING,
    ];
    const user = await search();
    const thresholdAnnouncer = getAnnouncer();
    const filterAnnouncer = screen.getByRole("status", { name: "絞り込みの結果" });
    const waitForSettled = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });

    // 絞り込み（cs.AI）: 絞り込みの通知だけが鳴る
    const filterToggle = screen.getByRole("button", { name: /^絞り込み($|（)/ });
    await user.click(filterToggle);
    const filterPanel = document.getElementById(filterToggle.getAttribute("aria-controls") ?? "");
    await user.click(within(filterPanel as HTMLElement).getByRole("button", { name: /^cs\.AI / }));
    expect(screen.queryByText("Mid Paper")).not.toBeInTheDocument();
    await waitFor(() => expect(filterAnnouncer).toHaveTextContent("cs.AI: 2件の論文を表示"));
    // 画面の「N件の論文」と同じ件数
    expect(getDisplayedCount()).toBe("2");
    await waitForSettled();
    expect(thresholdAnnouncer).toHaveTextContent("");

    // しきい値: しきい値の通知だけが鳴り、件数が変わっても絞り込みの通知は更新しない
    fireEvent.change(await openSlider(user), { target: { value: "1" } });
    await waitFor(() =>
      expect(thresholdAnnouncer).toHaveTextContent("しきい値 1.00: 1件の論文を表示")
    );
    expect(getDisplayedCount()).toBe("1");
    await waitForSettled();
    // 絞り込みの通知は再通知せず、古い件数（2件）も残さない
    expect(filterAnnouncer).toHaveTextContent("");
  });

  it("クエリEmbeddingがない検索では、スライダーを無効にして理由を表示する", async () => {
    mockFetch({ withEmbedding: false });
    const user = await search();
    const slider = await openSlider(user);
    expect(slider).toBeDisabled();
    expect(slider).toHaveAccessibleDescription(
      "この検索では類似度を計算できないため（APIキー未設定など）、しきい値を適用できません。設定でAPIキーを入力して再検索すると調整できます。"
    );
  });

  it("別の検索をすると、前の検索で出した件数の通知を残さない", async () => {
    const user = await search();
    fireEvent.change(await openSlider(user), { target: { value: "0.8" } });
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("2件の論文を表示"));

    const searchbox = screen.getByRole("searchbox");
    await user.clear(searchbox);
    await user.type(searchbox, "diffusion{Enter}");
    await waitFor(() => expect(countSearchRequests()).toBe(2));
    await screen.findByRole("button", { name: /^しきい値/ });
    expect(getAnnouncer()).toHaveTextContent("");
  });

  it("別の検索をすると、前の検索で出した絞り込みの通知も残さない（#52）", async () => {
    paperState.papers = [NEAR, createPaper("2401.00002", "Mid Paper", [1, 1], ["cs.LG"])];
    const user = await search();
    const filterToggle = screen.getByRole("button", { name: /^絞り込み($|（)/ });
    await user.click(filterToggle);
    await user.click(screen.getByRole("button", { name: /^cs\.AI / }));
    const filterAnnouncer = screen.getByRole("status", { name: "絞り込みの結果" });
    await waitFor(() => expect(filterAnnouncer).toHaveTextContent("1件の論文を表示"));

    const searchbox = screen.getByRole("searchbox");
    await user.clear(searchbox);
    await user.type(searchbox, "diffusion{Enter}");
    await waitFor(() => expect(countSearchRequests()).toBe(2));
    await screen.findByRole("button", { name: /^しきい値/ });
    expect(screen.getByRole("status", { name: "絞り込みの結果" })).toHaveTextContent("");
  });
});
