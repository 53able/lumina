/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { useHomeSearch } from "../hooks/useHomeSearch";
import { usePaperStore } from "../stores/paperStore";
import { createTestSearchSource } from "../testing/paperStoreTestUtils";
import { PaperExplorer } from "./PaperExplorer";

const {
  mockToggleLike,
  mockToggleBookmark,
  mockClearAllFilters,
  mockClearSearchAndFilters,
  mockSearchApi,
  mediaState,
} = vi.hoisted(() => ({
  mockToggleLike: vi.fn(),
  mockToggleBookmark: vi.fn(),
  mockClearAllFilters: vi.fn(),
  mockClearSearchAndFilters: vi.fn(),
  mockSearchApi: vi.fn(),
  mediaState: { isDesktop: true },
}));

// 検索APIだけをモックし、useHomeSearch / useSemanticSearch は実物を使う（useHomeSearch.test.tsx と同じ方針）
vi.mock("../lib/api", () => ({
  getDecryptedApiKey: vi.fn(async () => "sk-test"),
  searchApi: (...args: unknown[]) => mockSearchApi(...args),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// InteractionContextをモック
vi.mock("@/client/contexts/InteractionContext", () => ({
  useInteractionContext: () => ({
    likedPaperIds: new Set<string>(),
    bookmarkedPaperIds: new Set<string>(),
    toggleLike: mockToggleLike,
    toggleBookmark: mockToggleBookmark,
  }),
  useInteraction: (paperId: string) => ({
    isLiked: false,
    isBookmarked: false,
    toggleLike: () => mockToggleLike(paperId),
    toggleBookmark: () => mockToggleBookmark(paperId),
  }),
}));

// usePaperFilter は実装をそのまま使い（URL を実際に更新する）、クリア系の呼び出しだけ記録する
vi.mock("@/client/hooks/usePaperFilter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/usePaperFilter")>();
  return {
    ...actual,
    usePaperFilter: () => {
      const result = actual.usePaperFilter();
      return {
        ...result,
        clearAllFilters: () => {
          mockClearAllFilters();
          result.clearAllFilters();
        },
        clearSearchAndFilters: () => {
          mockClearSearchAndFilters();
          result.clearSearchAndFilters();
        },
      };
    },
  };
});

// デスクトップ／モバイルのレイアウトをテストごとに切り替える
vi.mock("@/client/hooks/useMediaQuery", () => ({
  useMediaQuery: () => mediaState.isDesktop,
}));

// jsdom はレイアウトを計算しないため、仮想スクロールは全件を1行で返す（PaperList.test.tsx と同じ方針）
vi.mock("@/client/hooks/useGridVirtualizer", () => ({
  useGridVirtualizer: (params: { items: Paper[] }) => ({
    virtualRows:
      params.items.length === 0
        ? []
        : [{ index: 0, start: 0, size: 300, items: params.items, isExpanded: false }],
    totalSize: params.items.length * 300,
    columnCount: Math.max(params.items.length, 1),
    itemWidth: 300,
    measureElement: () => undefined,
  }),
}));

const embedding = [0.1, 0.2, 0.3];

/** searchApi の応答（論文と同じ Embedding なので全件が検索結果になる） */
const searchResponse = (query: string) => ({
  expandedQuery: { original: query, english: query, synonyms: [], searchText: query },
  queryEmbedding: embedding,
});

// モック用の論文データ
const mockPapers: Paper[] = [
  {
    id: "2401.00001",
    title: "Attention Is All You Need",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    categories: ["cs.CL", "cs.LG"],
    publishedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    pdfUrl: "https://arxiv.org/pdf/2401.00001.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00001",
    embedding,
  },
  {
    id: "2401.00002",
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    abstract: "We introduce a new language representation model called BERT...",
    authors: ["Jacob Devlin", "Ming-Wei Chang"],
    categories: ["cs.CL"],
    publishedAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    pdfUrl: "https://arxiv.org/pdf/2401.00002.pdf",
    arxivUrl: "https://arxiv.org/abs/2401.00002",
    embedding,
  },
];

/** 現在の location.search を表示する */
const LocationSearch = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

/**
 * MemoryRouterでラップしたレンダリングヘルパー
 */
const renderExplorer = (props: ComponentProps<typeof PaperExplorer> = {}, initialRoute = "/") => {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <PaperExplorer {...props} />
      <LocationSearch />
    </MemoryRouter>
  );
};

/**
 * App.tsx と同じく useHomeSearch の戻り値を PaperExplorer に渡すハーネス
 * （App.tsx での displayPapers の組み立ては簡略化している）
 */
const HomeSearchHarness = () => {
  const home = useHomeSearch({
    papers: mockPapers,
    addHistory: async () => {},
    searchSource: createTestSearchSource(mockPapers),
  });
  const displayPapers =
    home.completedQuery !== null ? home.results.map((result) => result.paper) : mockPapers;

  return (
    <PaperExplorer
      initialPapers={displayPapers}
      onSearch={home.handleSearch}
      onClear={home.handleClearSearch}
      isSearchLoading={home.isLoading}
      externalQuery={home.completedQuery}
      searchInputValue={home.searchInputValue}
      onSearchInputChange={home.setSearchInputValue}
    />
  );
};

const renderHomeSearchHarness = () => {
  return render(
    <MemoryRouter>
      <HomeSearchHarness />
      <LocationSearch />
    </MemoryRouter>
  );
};

const getLocationSearch = () => screen.getByTestId("location-search").textContent;

describe("PaperExplorer", () => {
  let scrollToSpy: MockInstance;

  beforeAll(() => {
    // jsdom は Element#scrollTo を実装していない（PaperList が検索0件→一覧復帰時に呼ぶ）
    Element.prototype.scrollTo ??= () => {};
    scrollToSpy = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});
  });

  afterAll(() => {
    scrollToSpy.mockRestore();
  });

  beforeEach(() => {
    mediaState.isDesktop = true;
    mockSearchApi.mockReset();
  });

  describe("初期表示", () => {
    it("検索ボックスが表示される", () => {
      renderExplorer();

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "検索" })).toBeInTheDocument();
    });

    it("論文がない場合は未同期の空メッセージが表示される", () => {
      renderExplorer();

      expect(screen.getByText("このデバイスにはまだ論文がありません")).toBeInTheDocument();
    });

    it("論文がある場合はリストが表示される", () => {
      renderExplorer({ initialPapers: mockPapers });

      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(
        screen.getByText("BERT: Pre-training of Deep Bidirectional Transformers")
      ).toBeInTheDocument();
    });
  });

  describe("検索機能", () => {
    it("isSearchLoading の間はローディング表示になり、検索欄が無効になる", () => {
      renderExplorer({ isSearchLoading: true }, "/?q=transformer");

      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
      expect(screen.getByRole("searchbox")).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("button", { name: "検索" })).toHaveAttribute("aria-disabled", "true");
    });

    it("検索するとonSearchコールバックが呼ばれる", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderExplorer({ onSearch: mockOnSearch });

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      expect(mockOnSearch).toHaveBeenCalledWith("transformer");
    });

    it("PaperExplorer 自身は URL の q を更新しない（更新は onSearch 側の責務）", async () => {
      const mockOnSearch = vi.fn().mockResolvedValue(mockPapers);

      renderExplorer({ onSearch: mockOnSearch });

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      // onSearch の Promise 解決後の state 更新まで流しきってから確認する
      await act(async () => {});
      expect(mockOnSearch).toHaveBeenCalledTimes(1);
      expect(getLocationSearch()).toBe("");
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });

    it("検索完了後、結果と件数が表示され、URL の q が更新される", async () => {
      mockSearchApi.mockImplementation(async ({ query }: { query: string }) =>
        searchResponse(query)
      );
      renderHomeSearchHarness();

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      await waitFor(() => {
        expect(screen.getByText(/件の論文/)).toHaveTextContent("2件の論文");
      });
      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(getLocationSearch()).toBe("?q=transformer");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });

    it("検索中は入力が無効で、クリア後は空の入力欄に入力できる", async () => {
      // 検索APIが応答しない状態を作る
      mockSearchApi.mockImplementation(() => new Promise(() => {}));
      renderHomeSearchHarness();

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      await waitFor(() =>
        expect(screen.getByRole("searchbox")).toHaveAttribute("aria-disabled", "true")
      );
      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();
      expect(getLocationSearch()).toBe("?q=transformer");

      await user.click(screen.getByRole("button", { name: "検索と絞り込みをクリア" }));

      const searchbox = screen.getByRole("searchbox");
      expect(searchbox).not.toHaveAttribute("aria-disabled");
      expect(searchbox).toHaveValue("");
      expect(getLocationSearch()).toBe("");
      expect(screen.queryByTestId("paper-list-loading")).not.toBeInTheDocument();

      await user.type(searchbox, "bert");
      expect(searchbox).toHaveValue("bert");
      expect(mockSearchApi).toHaveBeenCalledTimes(1);
    });
  });

  describe("検索結果表示の判定（isExternalSearch）", () => {
    it("URL の q と externalQuery が一致するときは initialPapers を検索結果として表示する", () => {
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer"
      );

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        '"transformer" の検索結果'
      );
      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(screen.getByText(/件の論文/)).toHaveTextContent("2件の論文");
    });

    it("URL の q の前後の空白は無視して externalQuery と比較する", () => {
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=%20transformer%20"
      );

      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(screen.getByText(/件の論文/)).toHaveTextContent("2件の論文");
    });

    it("URL の q と externalQuery が一致しないときは initialPapers を表示しない", () => {
      renderExplorer({ initialPapers: mockPapers, externalQuery: "bert" }, "/?q=transformer");

      expect(screen.queryByText("Attention Is All You Need")).not.toBeInTheDocument();
      expect(screen.queryByText(/件の論文/)).not.toBeInTheDocument();
    });

    it("検索結果が揃う前（externalQuery が null）は initialPapers を表示しない", () => {
      renderExplorer({ initialPapers: mockPapers, externalQuery: null }, "/?q=transformer");

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        '"transformer" の検索結果'
      );
      expect(screen.queryByText("Attention Is All You Need")).not.toBeInTheDocument();
    });
  });

  describe("クリア操作の配線", () => {
    it("検索0件の空表示の「検索・絞り込みを解除」は見出し横の「クリア」と同じく検索語とフィルターを消す", async () => {
      // 論文は保存済み（0件の原因は検索条件）
      usePaperStore.setState({ papers: mockPapers });
      try {
        renderExplorer({ initialPapers: [], externalQuery: "transformer" }, "/?q=transformer");

        const user = userEvent.setup({ delay: null });
        await user.click(screen.getByRole("button", { name: "検索・絞り込みを解除" }));

        expect(mockClearSearchAndFilters).toHaveBeenCalledTimes(1);
        expect(getLocationSearch()).toBe("");
      } finally {
        usePaperStore.setState({ papers: [] });
      }
    });

    it("見出し横の「クリア」は検索語とフィルターをまとめて消す", async () => {
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL&filter=liked"
      );

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "検索と絞り込みをクリア" }));

      expect(mockClearSearchAndFilters).toHaveBeenCalledTimes(1);
      expect(mockClearAllFilters).not.toHaveBeenCalled();
      expect(getLocationSearch()).toBe("");
    });

    it("カテゴリ欄のクリアはフィルターだけを消し、検索語を残す", async () => {
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL"
      );

      const user = userEvent.setup({ delay: null });
      // デスクトップのカテゴリは折りたたみ領域（#68）。開いてから解除する
      await user.click(screen.getByRole("button", { name: /^カテゴリ/ }));
      const categoryGroup = screen.getByRole("group", { name: "カテゴリで絞り込み" });
      await user.click(within(categoryGroup).getByRole("button", { name: "絞り込みをすべて解除" }));

      expect(mockClearAllFilters).toHaveBeenCalledTimes(1);
      expect(mockClearSearchAndFilters).not.toHaveBeenCalled();
      expect(getLocationSearch()).toBe("?q=transformer");
    });

    it("モバイルでも見出し横のアイコンだけの「検索と絞り込みをクリア」は名前で操作でき、検索語とフィルターを消す", async () => {
      mediaState.isDesktop = false;
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL"
      );

      // モバイルでは「クリア」の文字を出さず、アイコンだけになる
      expect(screen.queryByText("クリア")).not.toBeInTheDocument();

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "検索と絞り込みをクリア" }));

      expect(mockClearSearchAndFilters).toHaveBeenCalledTimes(1);
      expect(getLocationSearch()).toBe("");
    });

    it("モバイルの「絞り込みをクリア」はフィルターだけを消し、検索語を残す", async () => {
      mediaState.isDesktop = false;
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL"
      );

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: /^絞り込み($|（)/ }));
      await user.click(await screen.findByRole("button", { name: "絞り込みをクリア" }));

      expect(mockClearAllFilters).toHaveBeenCalledTimes(1);
      expect(mockClearSearchAndFilters).not.toHaveBeenCalled();
      expect(getLocationSearch()).toBe("?q=transformer");
    });
  });

  describe("モバイルの絞り込み（一覧と並べて操作する）", () => {
    beforeEach(() => {
      mediaState.isDesktop = false;
    });

    const getFilterAnnouncer = () => screen.getByRole("status", { name: "絞り込みの結果" });

    /** 通知の待ち時間（400ms）を過ぎるまで待つ */
    const waitForAnnounceDelay = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

    /** 開閉ボタンと、それが制御する絞り込み領域を返す */
    const getFilterDisclosure = () => {
      const toggle = screen.getByRole("button", { name: /^絞り込み($|（)/ });
      const panelId = toggle.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) throw new Error("aria-controls が指す絞り込み領域がない");
      return { toggle, panel };
    };

    it("開閉ボタンは aria-expanded / aria-controls で領域の開閉を伝え、開いてもフォーカスを移さない", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const { toggle, panel } = getFilterDisclosure();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();

      const user = userEvent.setup({ delay: null });
      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(panel).toBeVisible();
      expect(screen.getByRole("region", { name: "絞り込み条件" })).toBe(panel);
      expect(toggle).toHaveFocus();

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
    });

    it("開いたままでも一覧は隠れず（dialog・aria-hidden・inert なし）、論文を選択できる", async () => {
      const mockOnPaperClick = vi.fn();
      renderExplorer({ initialPapers: mockPapers, onPaperClick: mockOnPaperClick });

      const user = userEvent.setup({ delay: null });
      const toggle = screen.getByRole("button", { name: /^絞り込み($|（)/ });
      await user.click(toggle);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const firstArticle = screen.getAllByRole("article")[0] as HTMLElement;
      expect(firstArticle.closest("[aria-hidden='true'], [inert]")).toBeNull();

      await user.click(firstArticle);
      expect(mockOnPaperClick).toHaveBeenCalledWith(mockPapers[0]);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("条件を変えると、領域を開いたまま一覧と件数が即時に更新される", async () => {
      renderExplorer({ initialPapers: mockPapers });

      expect(screen.getByTestId("filter-result-count")).toHaveTextContent("2件");

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: /^cs\.LG / }));

      expect(getLocationSearch()).toBe("?cat=cs.LG");
      expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      expect(
        screen.queryByText("BERT: Pre-training of Deep Bidirectional Transformers")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("filter-result-count")).toHaveTextContent("1件");
      expect(getFilterDisclosure().toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("条件を変えたときだけ、操作が落ち着いてから結果を1回通知する（表示用の件数は live にしない）", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const announcer = getFilterAnnouncer();
      expect(announcer).toHaveAttribute("aria-live", "polite");
      expect(announcer).toHaveAttribute("aria-atomic", "true");
      expect(announcer).toHaveTextContent("");
      expect(screen.getByTestId("filter-result-count")).not.toHaveAttribute("aria-live");
      expect(screen.getByTestId("filter-result-count").closest("[aria-live]")).toBeNull();

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      // 開閉だけでは通知しない
      await waitForAnnounceDelay();
      expect(announcer).toHaveTextContent("");

      await user.click(screen.getByRole("button", { name: /^cs\.LG / }));
      // 連続操作で読み上げを連発しないよう、すぐには更新しない
      expect(announcer).toHaveTextContent("");
      await waitFor(() => expect(announcer).toHaveTextContent("cs.LG: 1件の論文を表示"));
    });

    it("同期で論文が追加されて件数が変わっても通知しない", async () => {
      usePaperStore.setState({ papers: [mockPapers[0] as Paper] });
      try {
        renderExplorer();
        const announcer = getFilterAnnouncer();

        // 条件を変える前の追加では通知しない
        act(() => usePaperStore.setState({ papers: mockPapers }));
        await waitForAnnounceDelay();
        expect(screen.getByTestId("filter-result-count")).toHaveTextContent("2件");
        expect(announcer).toHaveTextContent("");

        const user = userEvent.setup({ delay: null });
        await user.click(getFilterDisclosure().toggle);
        await user.click(screen.getByRole("button", { name: /^cs\.CL / }));
        await waitFor(() => expect(announcer).toHaveTextContent("cs.CL: 2件の論文を表示"));

        // 通知後の同期による追加でも再通知せず、古い件数の通知は空にする
        const added: Paper = { ...(mockPapers[1] as Paper), id: "2401.00003", title: "Added" };
        act(() => usePaperStore.setState({ papers: [...mockPapers, added] }));
        await waitForAnnounceDelay();
        expect(screen.getByTestId("filter-result-count")).toHaveTextContent("3件");
        expect(announcer).toHaveTextContent("");
      } finally {
        usePaperStore.setState({ papers: [] });
      }
    });

    it("検索中は表示件数を空にし、0件と誤読させない", () => {
      renderExplorer({ initialPapers: mockPapers, isSearchLoading: true }, "/?cat=cs.CL");

      expect(screen.getByTestId("filter-result-count")).toHaveTextContent("");
    });

    it("表示モードのボタンは名前と aria-pressed を持ち、選択中のモードは0件でも押して解除できる", async () => {
      renderExplorer({ initialPapers: mockPapers }, "/?filter=liked");

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);

      const all = screen.getByRole("button", { name: "すべて" });
      const liked = screen.getByRole("button", { name: "いいね（0件）" });
      const bookmarked = screen.getByRole("button", { name: "ブックマーク（0件）" });
      expect(all).toHaveAttribute("aria-pressed", "false");
      expect(liked).toHaveAttribute("aria-pressed", "true");
      expect(bookmarked).toHaveAttribute("aria-pressed", "false");
      // 選択中のモードは0件でも無効にしない（解除できなくなるのを防ぐ）
      expect(liked).toBeEnabled();
      expect(bookmarked).toBeDisabled();

      await user.click(liked);
      expect(getLocationSearch()).toBe("");
      expect(all).toHaveAttribute("aria-pressed", "true");
      expect(liked).toHaveAttribute("aria-pressed", "false");
      expect(liked).toBeDisabled();
      // 押したボタンが無効になるため、フォーカスを「すべて」へ移す（body へ落とさない）
      expect(all).toHaveFocus();
    });

    it("0件のブックマーク表示を解除しても、フォーカスを「すべて」へ移す", async () => {
      renderExplorer({ initialPapers: mockPapers }, "/?filter=bookmarked");

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: "ブックマーク（0件）" }));

      expect(screen.getByRole("button", { name: "ブックマーク（0件）" })).toBeDisabled();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "すべて" }));
    });

    it("検索中に条件を変えても、待機後に通知しない", async () => {
      renderExplorer({ initialPapers: mockPapers, isSearchLoading: true });

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: /^cs\.LG / }));
      expect(getLocationSearch()).toBe("?cat=cs.LG");
      await waitForAnnounceDelay();

      expect(getFilterAnnouncer()).toHaveTextContent("");
    });

    it("カテゴリ欄の「絞り込みをすべて解除」でもフォーカスを開閉ボタンへ移す", async () => {
      renderExplorer({ initialPapers: mockPapers }, "/?cat=cs.LG");

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      const categoryGroup = screen.getByRole("group", { name: "カテゴリで絞り込み" });
      await user.click(within(categoryGroup).getByRole("button", { name: "絞り込みをすべて解除" }));

      expect(getLocationSearch()).toBe("");
      expect(getFilterDisclosure().toggle).toHaveFocus();
      expect(getFilterDisclosure().toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("検索0件でカテゴリ条件だけが有効なときに解除しても、開閉ボタンを消さずフォーカスを保つ", async () => {
      renderExplorer(
        { initialPapers: [], externalQuery: "transformer" },
        "/?q=transformer&cat=cs.LG"
      );

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: "絞り込みをクリア" }));

      expect(getLocationSearch()).toBe("?q=transformer");
      const { toggle } = getFilterDisclosure();
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      // 閉じたら、絞り込む対象がないので開閉ボタンも消える。フォーカスは検索欄へ移す
      await user.click(toggle);
      expect(screen.queryByRole("button", { name: /^絞り込み($|（)/ })).not.toBeInTheDocument();
      expect(screen.getByRole("searchbox")).toHaveFocus();
    });

    it("折りたたんだままでも適用中の条件と件数が見える", () => {
      renderExplorer({ initialPapers: mockPapers }, "/?cat=cs.LG");

      const { toggle } = getFilterDisclosure();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAccessibleName("絞り込み（適用中の条件1件）");
      expect(screen.getByText("cs.LG", { selector: "p" })).toBeInTheDocument();
      expect(screen.getByTestId("filter-result-count")).toHaveTextContent("1件");
    });

    it("「絞り込みをクリア」は領域を閉じず、フォーカスを開閉ボタンへ移す", async () => {
      renderExplorer({ initialPapers: mockPapers }, "/?cat=cs.LG");

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: "絞り込みをクリア" }));

      const { toggle, panel } = getFilterDisclosure();
      expect(getLocationSearch()).toBe("");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(panel).toBeVisible();
      expect(toggle).toHaveFocus();
      expect(screen.getByTestId("filter-result-count")).toHaveTextContent("2件");
    });

    it("領域内で Esc を押すと折りたたみ、フォーカスを開閉ボタンへ戻す", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(getFilterDisclosure().toggle);
      await user.click(screen.getByRole("button", { name: /^cs\.CL / }));
      expect(screen.getByRole("button", { name: /^cs\.CL / })).toHaveFocus();

      await user.keyboard("{Escape}");

      const { toggle, panel } = getFilterDisclosure();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
      expect(toggle).toHaveFocus();
      // 条件は保持される
      expect(getLocationSearch()).toBe("?cat=cs.CL");
    });

    it("Tab で絞り込み領域から一覧へフォーカスを進められる（フォーカストラップなし）", async () => {
      renderExplorer({ initialPapers: [mockPapers[1] as Paper] });

      const user = userEvent.setup({ delay: null });
      const { toggle } = getFilterDisclosure();
      await user.click(toggle);
      // 領域内の最後の操作（ブックマーク）は 0 件で無効のため、「すべて」から Tab で抜ける
      await user.click(screen.getByRole("button", { name: "すべて" }));
      await user.tab();

      const panel = getFilterDisclosure().panel;
      expect(panel.contains(document.activeElement)).toBe(false);
      expect(toggle).not.toHaveFocus();
      // 次のフォーカス先は一覧の論文カード内の操作
      expect(document.activeElement).toHaveAccessibleName("いいね");
    });
  });

  describe("選択中の論文と絞り込み", () => {
    it("選択中（展開中）の論文が絞り込みで一覧から外れたら、その旨を表示する", () => {
      renderExplorer(
        {
          initialPapers: mockPapers,
          expandedPaperId: "2401.00002",
          renderExpandedDetail: () => null,
        },
        "/?cat=cs.LG"
      );

      expect(
        screen.queryByText("BERT: Pre-training of Deep Bidirectional Transformers")
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("選択中の論文は絞り込み条件に合わないため、一覧に表示していません")
      ).toBeInTheDocument();
    });

    it("選択中の論文が一覧に残っているときは表示しない", () => {
      renderExplorer(
        {
          initialPapers: mockPapers,
          expandedPaperId: "2401.00001",
          renderExpandedDetail: () => null,
        },
        "/?cat=cs.LG"
      );

      expect(screen.queryByText(/選択中の論文は絞り込み条件に合わない/)).not.toBeInTheDocument();
    });
  });

  describe("ユーザーインタラクション", () => {
    it("いいねボタンをクリックするとtoggleLikeが呼ばれる", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getAllByRole("button", { name: "いいね" })[0] as HTMLElement);

      expect(mockToggleLike).toHaveBeenCalledWith("2401.00001");
    });

    it("ブックマークボタンをクリックするとtoggleBookmarkが呼ばれる", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getAllByRole("button", { name: "ブックマーク" })[0] as HTMLElement);

      expect(mockToggleBookmark).toHaveBeenCalledWith("2401.00001");
    });

    it("論文カードをクリックするとonPaperClickコールバックが呼ばれる", async () => {
      const mockOnPaperClick = vi.fn();

      renderExplorer({ initialPapers: mockPapers, onPaperClick: mockOnPaperClick });

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getAllByRole("article")[0] as HTMLElement);

      expect(mockOnPaperClick).toHaveBeenCalledWith(mockPapers[0]);
    });
  });

  describe("デスクトップのカテゴリ（#68: 検索→条件→一覧の順に、一覧を押し下げない）", () => {
    /** 多数のカテゴリを持つ論文（探す欄が出る件数） */
    const manyCategoryPapers: Paper[] = [
      {
        ...(mockPapers[0] as Paper),
        categories: ["cs.AI", "cs.CL", "cs.CV", "cs.IR", "cs.LG", "cs.RO", "stat.ML"],
      },
      mockPapers[1] as Paper,
    ];

    const getCategoryDisclosure = () => {
      const toggle = screen.getByRole("button", { name: /^カテゴリ/ });
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      if (!panel) throw new Error("aria-controls が指すカテゴリ領域がない");
      return { toggle, panel };
    };

    it("カテゴリは折りたたまれており、一覧より前に全カテゴリを並べない", () => {
      renderExplorer({ initialPapers: manyCategoryPapers });

      const { toggle, panel } = getCategoryDisclosure();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
      expect(screen.queryByRole("button", { name: /^cs\.CV / })).not.toBeInTheDocument();
    });

    it("開くと分野名・コードで探して選べ、閉じても適用中のカテゴリが名前付きで見える", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers });

      const user = userEvent.setup({ delay: null });
      const { toggle, panel } = getCategoryDisclosure();
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("region", { name: "カテゴリ" })).toBe(panel);

      await user.type(
        within(panel).getByRole("textbox", { name: "カテゴリを分野名・コードで探す" }),
        "ビジョン"
      );
      await user.click(within(panel).getByRole("button", { name: "cs.CV コンピュータビジョン" }));
      expect(getLocationSearch()).toBe("?cat=cs.CV");

      await user.click(toggle);
      expect(panel).not.toBeVisible();
      expect(getCategoryDisclosure().toggle).toHaveAccessibleName("カテゴリ（選択中1件）");
      expect(
        screen.getByRole("button", { name: "cs.CV（コンピュータビジョン）の絞り込みを解除" })
      ).toBeVisible();
    });

    it("適用中のカテゴリはその場で解除でき、フォーカスを開閉ボタンへ移す", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers }, "/?cat=cs.LG");

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "cs.LG（機械学習）の絞り込みを解除" }));

      expect(getLocationSearch()).toBe("");
      expect(getCategoryDisclosure().toggle).toHaveFocus();
    });

    it("チップの解除は、そのカテゴリだけを外し、他のカテゴリといいね表示を残す", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers }, "/?filter=liked&cat=cs.LG&cat=cs.CV");

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "cs.LG（機械学習）の絞り込みを解除" }));

      const params = new URLSearchParams(getLocationSearch() ?? "");
      expect(params.get("filter")).toBe("liked");
      expect(params.getAll("cat")).toEqual(["cs.CV"]);
      expect(
        screen.getByRole("button", { name: "cs.CV（コンピュータビジョン）の絞り込みを解除" })
      ).toBeInTheDocument();
    });

    it("カテゴリが1件以下で開閉ボタンがないときは、チップの解除後のフォーカスを検索欄へ移す", async () => {
      // URL で指定したカテゴリが一覧の論文にない（カテゴリは cs.CL の1件だけ）
      renderExplorer({ initialPapers: [mockPapers[1] as Paper] }, "/?cat=cs.LG");
      expect(screen.queryByRole("button", { name: /^カテゴリ/ })).not.toBeInTheDocument();

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "cs.LG（機械学習）の絞り込みを解除" }));

      expect(getLocationSearch()).toBe("");
      expect(screen.getByRole("searchbox")).toHaveFocus();
    });

    it("領域を閉じると、カテゴリの検索語をリセットする", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers });

      const user = userEvent.setup({ delay: null });
      const { toggle } = getCategoryDisclosure();
      await user.click(toggle);
      await user.type(
        screen.getByRole("textbox", { name: "カテゴリを分野名・コードで探す" }),
        "ビジョン"
      );
      await user.click(toggle);
      await user.click(toggle);

      expect(screen.getByRole("textbox", { name: "カテゴリを分野名・コードで探す" })).toHaveValue(
        ""
      );
      expect(screen.getByRole("button", { name: /^cs\.LG / })).toBeInTheDocument();
    });

    it("モバイルの絞り込み領域では、カテゴリ一覧の高さを低く保つ（一覧の先頭を押し出しすぎない）", async () => {
      mediaState.isDesktop = false;
      renderExplorer({ initialPapers: manyCategoryPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: /^絞り込み($|（)/ }));

      const list = screen.getByRole("button", { name: /^cs\.LG / }).closest("div");
      expect(list?.className).toContain("max-h-28");
    });

    it("開閉ボタンとチップはホバー・押下時に拡大・回転しない", () => {
      renderExplorer({ initialPapers: manyCategoryPapers }, "/?cat=cs.LG");

      for (const button of [
        getCategoryDisclosure().toggle,
        screen.getByRole("button", { name: "cs.LG（機械学習）の絞り込みを解除" }),
      ]) {
        expect(button.className).toContain("hover:scale-100");
        expect(button.className).toContain("hover:rotate-0");
        expect(button.className).not.toContain("hover:scale-110");
      }
    });

    it("領域内で Esc を押すと折りたたみ、フォーカスを開閉ボタンへ戻す", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(getCategoryDisclosure().toggle);
      await user.click(screen.getByRole("textbox", { name: "カテゴリを分野名・コードで探す" }));
      await user.keyboard("{Escape}");

      const { toggle, panel } = getCategoryDisclosure();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
      expect(toggle).toHaveFocus();
    });

    it("Tab の順序は 検索欄 → 絞り込み条件 → 一覧（カテゴリを開いていないときは中身を飛ばす）", async () => {
      renderExplorer({ initialPapers: manyCategoryPapers });

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("searchbox"));
      // 検索欄 → 検索ボタン → いいね・ブックマーク（0件で無効のため飛ばす）→ カテゴリ → 一覧の先頭カードの操作
      await user.tab();
      expect(screen.getByRole("button", { name: "検索" })).toHaveFocus();
      await user.tab();
      expect(getCategoryDisclosure().toggle).toHaveFocus();
      await user.tab();
      expect(document.activeElement).toHaveAccessibleName("いいね");
    });
  });

  describe("タイトル表示", () => {
    it("検索前はデフォルトのタイトルが表示される", () => {
      renderExplorer();

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });

    it("URL の q があるときは検索クエリが含まれたタイトルが表示される", () => {
      renderExplorer({}, "/?q=transformer");

      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        '"transformer" の検索結果'
      );
    });
  });
});
