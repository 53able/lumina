/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/client/stores/settingsStore";

describe("ApiSettings", () => {
  beforeEach(() => {
    // ストアをリセット
    useSettingsStore.getState().resetAllSettings();
  });

  afterEach(() => {
    cleanup();
  });

  describe("表示", () => {
    it("APIキー入力フィールドが表示される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      render(<ApiSettings />);

      // password型はtextboxではないのでlabelで探す
      expect(screen.getByLabelText(/api\s*key/i)).toBeInTheDocument();
    });

    it("保存ボタンが表示される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      render(<ApiSettings />);

      expect(screen.getByRole("button", { name: /保存/i })).toBeInTheDocument();
    });

    it("APIキーが未設定の場合、入力フィールドは空である", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      render(<ApiSettings />);

      const input = screen.getByLabelText(/api\s*key/i);
      expect(input).toHaveValue("");
    });
  });

  describe("APIキー保存", () => {
    it("APIキーを入力して保存ボタンを押すとストアに保存される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      const user = userEvent.setup();
      render(<ApiSettings />);

      const input = screen.getByLabelText(/api\s*key/i);
      const saveButton = screen.getByRole("button", { name: /保存/i });

      await user.type(input, "sk-test-api-key-12345");
      await user.click(saveButton);

      expect(useSettingsStore.getState().apiKey).toBe("sk-test-api-key-12345");
    });

    it("保存成功後、成功メッセージが表示される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      const user = userEvent.setup();
      render(<ApiSettings />);

      const input = screen.getByLabelText(/api\s*key/i);
      const saveButton = screen.getByRole("button", { name: /保存/i });

      await user.type(input, "sk-test-api-key-12345");
      await user.click(saveButton);

      expect(screen.getByText(/保存しました/i)).toBeInTheDocument();
    });
  });

  describe("APIキークリア", () => {
    it("APIキーが設定済みの場合、クリアボタンが表示される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      // 事前にAPIキーを設定
      useSettingsStore.getState().setApiKey("sk-existing-key");

      render(<ApiSettings />);

      expect(screen.getByRole("button", { name: /クリア/i })).toBeInTheDocument();
    });

    it("クリアボタンを押すとAPIキーが削除される", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      const user = userEvent.setup();
      // 事前にAPIキーを設定
      useSettingsStore.getState().setApiKey("sk-existing-key");

      render(<ApiSettings />);

      const clearButton = screen.getByRole("button", { name: /クリア/i });
      await user.click(clearButton);

      expect(useSettingsStore.getState().apiKey).toBe("");
    });
  });

  describe("セキュリティ", () => {
    it("入力フィールドはpassword型である（マスク表示）", async () => {
      const { ApiSettings } = await import("./ApiSettings");
      render(<ApiSettings />);

      const input = screen.getByLabelText(/api\s*key/i);
      expect(input).toHaveAttribute("type", "password");
    });
  });
});
