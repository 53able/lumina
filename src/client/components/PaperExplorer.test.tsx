/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "../../shared/schemas/index";
import { usePaperFilter } from "../hooks/usePaperFilter";
import { PaperExplorer } from "./PaperExplorer";

const {
  mockToggleLike,
  mockToggleBookmark,
  mockClearAllFilters,
  mockClearSearchAndFilters,
  mediaState,
} = vi.hoisted(() => ({
  mockToggleLike: vi.fn(),
  mockToggleBookmark: vi.fn(),
  mockClearAllFilters: vi.fn(),
  mockClearSearchAndFilters: vi.fn(),
  mediaState: { isDesktop: true },
}));

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
 * HomeMain + useHomeSearch の配線を模したハーネス
 * - 検索開始で URL の q を更新し、検索中は isSearchLoading を true にする
 * - クリア時は検索状態をリセットし、isSearchLoading を false に戻す
 */
const SearchHarness = ({ onSearch }: { onSearch: (query: string) => Promise<Paper[]> }) => {
  const { setSearchQuery } = usePaperFilter();
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setIsSearchLoading(true);
    try {
      return await onSearch(query);
    } finally {
      setIsSearchLoading(false);
    }
  };

  return (
    <PaperExplorer
      onSearch={handleSearch}
      onClear={() => setIsSearchLoading(false)}
      isSearchLoading={isSearchLoading}
    />
  );
};

const renderSearchHarness = (onSearch: (query: string) => Promise<Paper[]>) => {
  return render(
    <MemoryRouter>
      <SearchHarness onSearch={onSearch} />
      <LocationSearch />
    </MemoryRouter>
  );
};

const getLocationSearch = () => screen.getByTestId("location-search").textContent;

describe("PaperExplorer", () => {
  beforeAll(() => {
    // jsdom は Element#scrollTo を実装していない（PaperList が検索0件→一覧復帰時に呼ぶ）
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    mediaState.isDesktop = true;
  });

  describe("初期表示", () => {
    it("検索ボックスが表示される", () => {
      renderExplorer();

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "検索" })).toBeInTheDocument();
    });

    it("論文がない場合は空メッセージが表示される", () => {
      renderExplorer();

      expect(screen.getByText(/論文が見つかりません/i)).toBeInTheDocument();
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
      expect(screen.getByRole("searchbox")).toBeDisabled();
      expect(screen.getByRole("button", { name: "検索" })).toBeDisabled();
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

      await waitFor(() => expect(mockOnSearch).toHaveBeenCalled());
      expect(getLocationSearch()).toBe("");
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("論文を探す");
    });

    it("検索完了後、結果と件数が表示される", async () => {
      renderSearchHarness(vi.fn().mockResolvedValue(mockPapers));

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      await waitFor(() => {
        expect(screen.getByText("Attention Is All You Need")).toBeInTheDocument();
      });
      expect(screen.getByText(/件の論文/)).toHaveTextContent("2件の論文");
      expect(getLocationSearch()).toBe("?q=transformer");
    });

    it("検索中は入力が無効で、クリア後は入力できる", async () => {
      // 検索が終わらない状態を作る
      const pendingSearch = vi.fn(() => new Promise<Paper[]>(() => {}));
      renderSearchHarness(pendingSearch);

      const user = userEvent.setup({ delay: null });
      await user.type(screen.getByRole("searchbox"), "transformer");
      await user.click(screen.getByRole("button", { name: "検索" }));

      await waitFor(() => expect(screen.getByRole("searchbox")).toBeDisabled());
      expect(screen.getByTestId("paper-list-loading")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "クリア" }));

      const searchbox = screen.getByRole("searchbox");
      expect(searchbox).toBeEnabled();
      expect(getLocationSearch()).toBe("");
      await user.clear(searchbox);
      await user.type(searchbox, "bert");
      expect(searchbox).toHaveValue("bert");
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
    it("見出し横の「クリア」は検索語とフィルターをまとめて消す", async () => {
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL&filter=liked"
      );

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "クリア" }));

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
      const categoryGroup = screen.getByRole("group", { name: "カテゴリで絞り込み" });
      await user.click(within(categoryGroup).getByRole("button", { name: "" }));

      expect(mockClearAllFilters).toHaveBeenCalledTimes(1);
      expect(mockClearSearchAndFilters).not.toHaveBeenCalled();
      expect(getLocationSearch()).toBe("?q=transformer");
    });

    it("モバイルの「絞り込みをクリア」はフィルターだけを消し、検索語を残す", async () => {
      mediaState.isDesktop = false;
      renderExplorer(
        { initialPapers: mockPapers, externalQuery: "transformer" },
        "/?q=transformer&cat=cs.CL"
      );

      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole("button", { name: "絞り込みを開く" }));
      await user.click(await screen.findByRole("button", { name: "絞り込みをクリア" }));

      expect(mockClearAllFilters).toHaveBeenCalledTimes(1);
      expect(mockClearSearchAndFilters).not.toHaveBeenCalled();
      expect(getLocationSearch()).toBe("?q=transformer");
    });
  });

  describe("ユーザーインタラクション", () => {
    it("いいねボタンをクリックするとtoggleLikeが呼ばれる", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const user = userEvent.setup({ delay: null });
      const [firstLikeButton] = screen.getAllByRole("button", { name: "いいね" });
      expect(firstLikeButton).toBeDefined();
      if (firstLikeButton) {
        await user.click(firstLikeButton);
      }

      expect(mockToggleLike).toHaveBeenCalledWith("2401.00001");
    });

    it("ブックマークボタンをクリックするとtoggleBookmarkが呼ばれる", async () => {
      renderExplorer({ initialPapers: mockPapers });

      const user = userEvent.setup({ delay: null });
      const [firstBookmarkButton] = screen.getAllByRole("button", { name: "ブックマーク" });
      expect(firstBookmarkButton).toBeDefined();
      if (firstBookmarkButton) {
        await user.click(firstBookmarkButton);
      }

      expect(mockToggleBookmark).toHaveBeenCalledWith("2401.00001");
    });

    it("論文カードをクリックするとonPaperClickコールバックが呼ばれる", async () => {
      const mockOnPaperClick = vi.fn();

      renderExplorer({ initialPapers: mockPapers, onPaperClick: mockOnPaperClick });

      const user = userEvent.setup({ delay: null });
      const [firstArticle] = screen.getAllByRole("article");
      expect(firstArticle).toBeDefined();
      if (firstArticle) {
        await user.click(firstArticle);
      }

      expect(mockOnPaperClick).toHaveBeenCalledWith(mockPapers[0]);
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
