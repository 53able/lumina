/**
 * @vitest-environment jsdom
 *
 * 起動時のローカルデータ初期化に失敗したとき、白い画面で止まらずエラー画面を出すことを検証する（Issue #87）
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapApp } from "./bootstrap";
import { LuminaDB } from "./db/db";
import { useSettingsStore } from "./stores/settingsStore";

/** LuminaDB より新しい版の DB を先に作っておき、LuminaDB の open を VersionError で失敗させる */
const createDbThatFailsToOpen = async (name: string): Promise<LuminaDB> => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 100);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  return new LuminaDB(name);
};

let dbCounter = 0;
const uniqueDbName = () => `LuminaDB-bootstrap-test-${Date.now()}-${dbCounter++}`;

describe("bootstrapApp: 初期化失敗時のエラー画面", () => {
  let rootElement: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    rootElement.remove();
    consoleError.mockRestore();
    vi.restoreAllMocks();
  });

  it("DB の open に失敗したらエラー画面を表示し、再読み込みできる", async () => {
    const db = await createDbThatFailsToOpen(uniqueDbName());
    const reload = vi.fn();

    await bootstrapApp(rootElement, { db, reload });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Lumina を起動できませんでした" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "保存済みのデータについて" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(reload).toHaveBeenCalledTimes(1);

    // 内部のエラー名・メッセージは画面に出さない
    expect(rootElement.textContent).not.toMatch(/VersionError|Dexie|version/i);
    db.close();
  });

  it("ストアの初期化に失敗したらエラー画面を表示し、エラーのメッセージやスタックを出さない", async () => {
    const db = new LuminaDB(uniqueDbName());
    const secretError = new Error("decrypt failed for sk-test-SECRET-123");
    secretError.stack =
      "Error: decrypt failed\n    at initializeStore (/Users/someone/lumina/src/x.ts:1:1)";
    vi.spyOn(useSettingsStore.getState(), "initializeStore").mockRejectedValue(secretError);

    await bootstrapApp(rootElement, { db, reload: vi.fn() });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Lumina を起動できませんでした" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();

    const text = rootElement.textContent ?? "";
    expect(text).not.toContain("sk-test-SECRET-123");
    expect(text).not.toContain("decrypt failed");
    expect(text).not.toContain("/Users/someone");
    // 調査用に開発者ツールには残す
    expect(consoleError).toHaveBeenCalled();
    db.close();
  });

  it("論文詳細のURLで失敗したら、DB を使わない arXiv へのリンクを出す", async () => {
    window.history.pushState({}, "", "/papers/2401.00001v2");
    const db = await createDbThatFailsToOpen(uniqueDbName());

    await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const link = await within(rootElement).findByRole("link", { name: "arXiv で開く" });
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/2401.00001v2");
    db.close();
  });

  it("論文IDが arXiv の形式でなければ arXiv へのリンクを出さない", async () => {
    window.history.pushState({}, "", "/papers/not-an-id");
    const db = await createDbThatFailsToOpen(uniqueDbName());

    await bootstrapApp(rootElement, { db, reload: vi.fn() });

    await within(rootElement).findByRole("button", { name: "再読み込み" });
    expect(within(rootElement).queryByRole("link", { name: "arXiv で開く" })).toBeNull();
    db.close();
  });
});
