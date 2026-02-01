/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PaperSearch テスト
 *
 * Design Docsに基づく仕様:
 * - 検索ボックス（テキスト入力）
 * - 検索ボタン
 * - 検索実行時にコールバックを呼び出す
 */

describe("PaperSearch", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("レンダリング", () => {
    it("正常系: 検索ボックスと検索ボタンが表示される", async () => {
      const { PaperSearch } = await import("./PaperSearch");

      render(<PaperSearch onSearch={vi.fn()} />);

      // 検索ボックスが表示される
      expect(screen.getByRole("searchbox")).toBeInTheDocument();

      // 検索ボタンが表示される
      expect(screen.getByRole("button", { name: /検索/i })).toBeInTheDocument();
    });

    it("正常系: プレースホルダーが表示される", async () => {
      const { PaperSearch } = await import("./PaperSearch");

      render(<PaperSearch onSearch={vi.fn()} />);

      expect(screen.getByPlaceholderText(/論文を検索/i)).toBeInTheDocument();
    });
  });

  describe("検索機能", () => {
    it("正常系: 検索ボタンクリックでonSearchが呼ばれる", async () => {
      const { PaperSearch } = await import("./PaperSearch");
      const user = userEvent.setup();
      const handleSearch = vi.fn();

      render(<PaperSearch onSearch={handleSearch} />);

      // テキストを入力
      const searchBox = screen.getByRole("searchbox");
      await user.type(searchBox, "強化学習");

      // 検索ボタンをクリック
      const searchButton = screen.getByRole("button", { name: /検索/i });
      await user.click(searchButton);

      // onSearchが呼ばれる
      expect(handleSearch).toHaveBeenCalledWith("強化学習");
    });

    it("正常系: Enterキーで検索を実行できる", async () => {
      const { PaperSearch } = await import("./PaperSearch");
      const user = userEvent.setup();
      const handleSearch = vi.fn();

      render(<PaperSearch onSearch={handleSearch} />);

      // テキストを入力してEnter
      const searchBox = screen.getByRole("searchbox");
      await user.type(searchBox, "deep learning{Enter}");

      // onSearchが呼ばれる
      expect(handleSearch).toHaveBeenCalledWith("deep learning");
    });

    it("正常系: 空のクエリでは検索しない", async () => {
      const { PaperSearch } = await import("./PaperSearch");
      const user = userEvent.setup();
      const handleSearch = vi.fn();

      render(<PaperSearch onSearch={handleSearch} />);

      // 空のまま検索ボタンをクリック
      const searchButton = screen.getByRole("button", { name: /検索/i });
      await user.click(searchButton);

      // onSearchは呼ばれない
      expect(handleSearch).not.toHaveBeenCalled();
    });

    it("正常系: 検索後に入力がクリアされる", async () => {
      const { PaperSearch } = await import("./PaperSearch");
      const user = userEvent.setup();
      const handleSearch = vi.fn();

      render(<PaperSearch onSearch={handleSearch} clearAfterSearch />);

      // テキストを入力して検索
      const searchBox = screen.getByRole("searchbox");
      await user.type(searchBox, "test query");
      await user.click(screen.getByRole("button", { name: /検索/i }));

      // 入力がクリアされる
      expect(searchBox).toHaveValue("");
    });
  });

  describe("ローディング状態", () => {
    it("正常系: isLoading時にボタンが無効化される", async () => {
      const { PaperSearch } = await import("./PaperSearch");

      render(<PaperSearch onSearch={vi.fn()} isLoading />);

      const searchButton = screen.getByRole("button", { name: /検索/i });
      expect(searchButton).toBeDisabled();
    });

    it("正常系: isLoading時に検索ボックスが無効化される", async () => {
      const { PaperSearch } = await import("./PaperSearch");

      render(<PaperSearch onSearch={vi.fn()} isLoading />);

      const searchBox = screen.getByRole("searchbox");
      expect(searchBox).toBeDisabled();
    });
  });

  describe("初期値", () => {
    it("正常系: 初期クエリを設定できる", async () => {
      const { PaperSearch } = await import("./PaperSearch");

      render(<PaperSearch onSearch={vi.fn()} defaultQuery="初期クエリ" />);

      const searchBox = screen.getByRole("searchbox");
      expect(searchBox).toHaveValue("初期クエリ");
    });
  });

  describe("制御モード", () => {
    it("正常系: valueを渡すとその値が表示され、入力でonChangeが呼ばれる", async () => {
      const { PaperSearch } = await import("./PaperSearch");
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<PaperSearch onSearch={vi.fn()} value="制御された値" onChange={onChange} />);

      const searchBox = screen.getByRole("searchbox");
      expect(searchBox).toHaveValue("制御された値");

      await user.clear(searchBox);
      await user.type(searchBox, "x");

      expect(onChange).toHaveBeenCalled();
    });
  });
});
