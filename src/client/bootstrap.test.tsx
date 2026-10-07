/**
 * @vitest-environment jsdom
 *
 * 起動時のローカルデータ初期化に失敗したとき、白い画面で止まらずエラー画面を出すことを検証する（Issue #87）
 * DB の upgrade が他のタブに妨げられたとき・初期化が終わらないときに待機中の表示を出すことも検証する（Issue #110）
 */
import { act, fireEvent, screen, within } from "@testing-library/react";
import Dexie from "dexie";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapApp } from "./bootstrap";
import { LuminaDB } from "./db/db";
import { usePaperStore } from "./stores/paperStore";
import { useSettingsStore } from "./stores/settingsStore";
import { resetPaperStoreForTest } from "./testing/paperStoreTestUtils";

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

/**
 * LuminaDB の v1 の DB を作り、別タブの古い接続を模して開いたままにする。
 * versionchange を受けても閉じないため、LuminaDB（v2）の open は blocked になる
 */
const holdOldVersionConnection = async (name: string): Promise<IDBDatabase> => {
  const v1 = new Dexie(name);
  v1.version(1).stores({
    papers: "id, publishedAt, *categories",
    paperSummaries: "++, paperId, language, [paperId+language]",
    searchHistories: "id, createdAt",
    userInteractions: "id, paperId, type",
  });
  await v1.open();
  v1.close();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/** 別タブが新しい版で DB を開くのを模す（他の接続が閉じるまで完了しない） */
const openNewerVersion = (name: string, version: number): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let dbCounter = 0;
const uniqueDbName = () => `LuminaDB-bootstrap-test-${Date.now()}-${dbCounter++}`;

const ERROR_HEADING = { level: 1, name: "Lumina を起動できませんでした" } as const;

describe("bootstrapApp", () => {
  let rootElement: HTMLDivElement;
  let root: Root | undefined;
  let db: LuminaDB | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.history.pushState({}, "", "/");
    document.title = "Lumina";
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    db?.close();
    db = undefined;
    rootElement.remove();
    vi.restoreAllMocks();
    resetPaperStoreForTest();
  });

  it("初期化に成功したらアプリを描画する", async () => {
    db = new LuminaDB(uniqueDbName());

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const view = within(rootElement);
    expect(await view.findByRole("banner")).toBeInTheDocument();
    expect(await view.findByRole("main")).toBeInTheDocument();
    expect(view.queryByRole("heading", ERROR_HEADING)).toBeNull();
  });

  it("保存済み論文の読み込み完了を待たずにアプリを描画する（Issue #65）", async () => {
    db = new LuminaDB(uniqueDbName());
    // 論文の読み込み（読み取りトランザクション）が終わらない状態にする
    const pendingDb = db;
    vi.spyOn(pendingDb, "transaction").mockImplementation(
      (() => new Promise<never>(() => {})) as unknown as typeof pendingDb.transaction
    );

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const view = within(rootElement);
    expect(await view.findByRole("banner")).toBeInTheDocument();
    expect(view.queryByRole("heading", ERROR_HEADING)).toBeNull();
    expect(usePaperStore.getState().loadStatus).toBe("loading");
  });

  it("保存済み論文の読み込みに失敗しても起動エラー画面にせず、読み込み状態で示す（Issue #65）", async () => {
    db = new LuminaDB(uniqueDbName());
    const failingDb = db;
    vi.spyOn(failingDb, "transaction").mockImplementation((() =>
      Promise.reject(new Error("papers read failed"))) as unknown as typeof failingDb.transaction);

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const view = within(rootElement);
    expect(await view.findByRole("banner")).toBeInTheDocument();
    await vi.waitFor(() => expect(usePaperStore.getState().loadStatus).toBe("error"));
    expect(view.queryByRole("heading", ERROR_HEADING)).toBeNull();
  });

  it("API key の暗号化移行に失敗してもエラー画面にせず起動を続ける", async () => {
    db = new LuminaDB(uniqueDbName());
    vi.spyOn(useSettingsStore.getState(), "initializeStore").mockRejectedValue(
      new Error("crypto.subtle is unavailable")
    );

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const view = within(rootElement);
    expect(await view.findByRole("banner")).toBeInTheDocument();
    expect(view.queryByRole("heading", ERROR_HEADING)).toBeNull();
    expect(consoleWarn).toHaveBeenCalled();
  });

  it("DB の open に失敗したらエラー画面を表示し、再読み込みできる", async () => {
    db = await createDbThatFailsToOpen(uniqueDbName());
    const reload = vi.fn();

    root = await bootstrapApp(rootElement, { db, reload });

    expect(await screen.findByRole("heading", ERROR_HEADING)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "保存済みのデータについて" })).toBeInTheDocument();
    expect(document.title).toBe("起動エラー - Lumina");

    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(reload).toHaveBeenCalledTimes(1);

    // 内部のエラー名・メッセージは画面に出さない
    expect(rootElement.textContent).not.toMatch(/VersionError|Dexie|version/i);
  });

  it("ストアの初期化に失敗したらエラー画面を表示し、エラーのメッセージやスタックを出さない", async () => {
    db = new LuminaDB(uniqueDbName());
    const secretError = new Error("read failed for sk-test-SECRET-123");
    secretError.stack =
      "Error: read failed\n    at initializeInteractionStore (/Users/someone/lumina/src/x.ts:1:1)";
    vi.spyOn(db.userInteractions, "toArray").mockRejectedValue(secretError);

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    expect(await screen.findByRole("heading", ERROR_HEADING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();

    const text = rootElement.textContent ?? "";
    expect(text).not.toContain("sk-test-SECRET-123");
    expect(text).not.toContain("read failed");
    expect(text).not.toContain("/Users/someone");
    // 調査用に開発者ツールには残す
    expect(consoleError).toHaveBeenCalled();
  });

  it.each([
    "/papers/2401.00001v2",
    "/papers/2401.00001v2/",
  ])("論文詳細のURL（%s）で失敗したら、DB を使わない arXiv へのリンクを出す", async (path) => {
    window.history.pushState({}, "", path);
    db = await createDbThatFailsToOpen(uniqueDbName());

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    const link = await within(rootElement).findByRole("link", { name: "arXiv で開く" });
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/2401.00001v2");
  });

  it("論文IDが arXiv の形式でなければ arXiv へのリンクを出さない", async () => {
    window.history.pushState({}, "", "/papers/not-an-id");
    db = await createDbThatFailsToOpen(uniqueDbName());

    root = await bootstrapApp(rootElement, { db, reload: vi.fn() });

    await within(rootElement).findByRole("button", { name: "再読み込み" });
    expect(within(rootElement).queryByRole("link", { name: "arXiv で開く" })).toBeNull();
  });

  it("他のタブの古い接続で upgrade が blocked になったら、他のタブを閉じる案内を出し、閉じたら起動を続ける（Issue #110）", async () => {
    const name = uniqueDbName();
    const oldConnection = await holdOldVersionConnection(name);
    db = new LuminaDB(name);
    const reload = vi.fn();

    const pending = bootstrapApp(rootElement, { db, reload });

    expect(
      await screen.findByRole("heading", { level: 1, name: "他のタブを閉じてください" })
    ).toBeInTheDocument();
    expect(document.title).toBe("起動待ち - Lumina");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(reload).toHaveBeenCalledTimes(1);

    // 他のタブが接続を閉じると upgrade が進み、アプリに切り替わる
    oldConnection.close();
    root = await pending;

    const view = within(rootElement);
    expect(await view.findByRole("banner")).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "他のタブを閉じてください" })).toBeNull();
    expect(document.title).toBe("Lumina");
  });

  it("初期化が一定時間で終わらなければ待機中の表示に切り替え、終わったらアプリを描画する（Issue #110）", async () => {
    db = new LuminaDB(uniqueDbName());
    let finishRead: (value: never[]) => void = () => {};
    vi.spyOn(db.userInteractions, "toArray").mockReturnValue(
      new Promise<never[]>((resolve) => {
        finishRead = resolve;
      }) as unknown as ReturnType<typeof db.userInteractions.toArray>
    );

    const pending = bootstrapApp(rootElement, { db, reload: vi.fn(), slowInitMs: 10 });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Lumina の起動に時間がかかっています" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();

    finishRead([]);
    root = await pending;

    expect(await within(rootElement).findByRole("banner")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Lumina の起動に時間がかかっています" })
    ).toBeNull();
  });

  it("起動後に他のタブが新しい版で DB を開いたら、このタブの接続を閉じて再読み込みを促す（Issue #110）", async () => {
    const name = uniqueDbName();
    db = new LuminaDB(name);
    const reload = vi.fn();
    root = await bootstrapApp(rootElement, { db, reload });
    expect(await within(rootElement).findByRole("banner")).toBeInTheDocument();
    expect(db.isOpen()).toBe(true);

    // このタブが接続を閉じないと完了しない
    const newer = await openNewerVersion(name, 1000);
    newer.close();

    expect(db.isOpen()).toBe(false);
    expect(await screen.findByText("別のタブで保存データの更新が始まりました")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
