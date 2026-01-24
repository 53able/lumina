/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchHistory as SearchHistoryType } from "../../shared/schemas";
import { SearchHistory } from "./SearchHistory";

/**
 * SearchHistory コンポーネントテスト
 *
 * Design Docsに基づく仕様:
 * - 検索履歴一覧を表示
 * - 各履歴には元のクエリ、結果件数、日時が表示される
 * - クリックで再検索（ワンタップ再検索）
 * - 履歴を削除できる
 */

// テスト用のサンプル検索履歴データ
const createSampleHistory = (overrides: Partial<SearchHistoryType> = {}): SearchHistoryType => ({
  id: crypto.randomUUID(),
  originalQuery: "強化学習",
  expandedQuery: {
    original: "強化学習",
    english: "reinforcement learning",
    synonyms: ["RL", "reward-based learning"],
    searchText: "reinforcement learning RL reward-based learning",
  },
  resultCount: 42,
  createdAt: new Date("2026-01-17T10:00:00Z"),
  ...overrides,
});

describe("SearchHistory", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 検索履歴がない場合は空状態メッセージを表示する", () => {
      render(<SearchHistory histories={[]} />);

      expect(screen.getByText("検索履歴がありません")).toBeInTheDocument();
    });

    it("正常系: 検索履歴が表示される", () => {
      const histories = [createSampleHistory({ originalQuery: "強化学習" })];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText("強化学習")).toBeInTheDocument();
    });

    it("正常系: 検索結果件数が表示される", () => {
      const histories = [createSampleHistory({ resultCount: 42 })];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText(/42件/)).toBeInTheDocument();
    });

    it("正常系: 複数の検索履歴が表示される", () => {
      const histories = [
        createSampleHistory({ originalQuery: "強化学習" }),
        createSampleHistory({ originalQuery: "自然言語処理" }),
        createSampleHistory({ originalQuery: "コンピュータビジョン" }),
      ];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByText("強化学習")).toBeInTheDocument();
      expect(screen.getByText("自然言語処理")).toBeInTheDocument();
      expect(screen.getByText("コンピュータビジョン")).toBeInTheDocument();
    });

    it("正常系: 履歴ごとに削除ボタンが表示される", () => {
      const histories = [createSampleHistory()];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
    });
  });

  describe("再検索機能", () => {
    it("正常系: 履歴をクリックするとonReSearchが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const history = createSampleHistory({ originalQuery: "強化学習" });

      render(<SearchHistory histories={[history]} onReSearch={mockOnReSearch} />);

      // 履歴項目をクリック
      await user.click(screen.getByText("強化学習"));

      expect(mockOnReSearch).toHaveBeenCalledWith(history);
    });

    it("正常系: 再検索時に履歴の全情報が渡される", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const history = createSampleHistory({
        originalQuery: "強化学習",
        expandedQuery: {
          original: "強化学習",
          english: "reinforcement learning",
          synonyms: ["RL"],
          searchText: "reinforcement learning RL",
        },
      });

      render(<SearchHistory histories={[history]} onReSearch={mockOnReSearch} />);

      await user.click(screen.getByText("強化学習"));

      expect(mockOnReSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          originalQuery: "強化学習",
          expandedQuery: expect.objectContaining({
            english: "reinforcement learning",
          }),
        })
      );
    });
  });

  describe("削除機能", () => {
    it("正常系: 削除ボタンをクリックするとonDeleteが呼ばれる", async () => {
      const user = userEvent.setup();
      const mockOnDelete = vi.fn();
      const history = createSampleHistory();

      render(<SearchHistory histories={[history]} onDelete={mockOnDelete} />);

      // 削除ボタンをクリック
      await user.click(screen.getByRole("button", { name: "削除" }));

      expect(mockOnDelete).toHaveBeenCalledWith(history.id);
    });

    it("正常系: 削除ボタンクリック時に再検索は呼ばれない", async () => {
      const user = userEvent.setup();
      const mockOnReSearch = vi.fn();
      const mockOnDelete = vi.fn();
      const history = createSampleHistory();

      render(
        <SearchHistory histories={[history]} onReSearch={mockOnReSearch} onDelete={mockOnDelete} />
      );

      // 削除ボタンをクリック
      await user.click(screen.getByRole("button", { name: "削除" }));

      // 削除は呼ばれるが、再検索は呼ばれない
      expect(mockOnDelete).toHaveBeenCalled();
      expect(mockOnReSearch).not.toHaveBeenCalled();
    });
  });

  describe("アクセシビリティ", () => {
    it("正常系: 検索履歴リストはlist roleを持つ", () => {
      const histories = [createSampleHistory()];

      render(<SearchHistory histories={histories} />);

      expect(screen.getByRole("list")).toBeInTheDocument();
    });

    it("正常系: 各履歴項目はlistitem roleを持つ", () => {
      const histories = [createSampleHistory(), createSampleHistory()];

      render(<SearchHistory histories={histories} />);

      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
  });
});
