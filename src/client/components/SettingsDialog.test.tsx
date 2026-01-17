/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SettingsDialog テスト
 *
 * Design Docsに基づく仕様:
 * - ダイアログで設定画面を表示
 * - タブで設定項目を切り替え（API / カテゴリ / 同期 / キャッシュ）
 * - 閉じるボタンでダイアログを閉じる
 */
describe("SettingsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  describe("ダイアログ表示", () => {
    it("開いた状態でダイアログが表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("タイトルが表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      // ダイアログのタイトル（heading）を確認
      expect(screen.getByRole("heading", { name: /設定/i })).toBeInTheDocument();
    });

    it("閉じた状態ではダイアログが表示されない", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open={false} onOpenChange={() => {}} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("タブ構造", () => {
    it("APIタブが表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      expect(screen.getByRole("tab", { name: /api/i })).toBeInTheDocument();
    });

    it("カテゴリタブが表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      expect(screen.getByRole("tab", { name: /カテゴリ/i })).toBeInTheDocument();
    });

    it("同期タブが表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      expect(screen.getByRole("tab", { name: /同期/i })).toBeInTheDocument();
    });

    it("デフォルトでAPIタブが選択されている", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      render(<SettingsDialog open onOpenChange={() => {}} />);

      const apiTab = screen.getByRole("tab", { name: /api/i });
      expect(apiTab).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("タブ切り替え", () => {
    it("カテゴリタブをクリックするとカテゴリ設定が表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      const user = userEvent.setup();
      render(<SettingsDialog open onOpenChange={() => {}} />);

      const categoryTab = screen.getByRole("tab", { name: /カテゴリ/i });
      await user.click(categoryTab);

      expect(categoryTab).toHaveAttribute("aria-selected", "true");
    });

    it("同期タブをクリックすると同期設定が表示される", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      const user = userEvent.setup();
      render(<SettingsDialog open onOpenChange={() => {}} />);

      const syncTab = screen.getByRole("tab", { name: /同期/i });
      await user.click(syncTab);

      expect(syncTab).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("ダイアログ操作", () => {
    it("閉じるボタンをクリックするとonOpenChangeが呼ばれる", async () => {
      const { SettingsDialog } = await import("./SettingsDialog");
      const user = userEvent.setup();
      const handleOpenChange = vi.fn();
      render(<SettingsDialog open onOpenChange={handleOpenChange} />);

      // ダイアログの閉じるボタンをクリック
      const closeButton = screen.getByRole("button", { name: /閉じる|close/i });
      await user.click(closeButton);

      expect(handleOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
