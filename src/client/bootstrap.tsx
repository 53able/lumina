import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { App } from "./App";
import { InitErrorScreen, type InitScreenReason } from "./components/InitErrorScreen";
import { InteractionProvider } from "./contexts/InteractionContext";
import { type LuminaDB, luminaDb } from "./db/db";
import { warmupCrypto } from "./lib/crypto";
import { initializeInteractionStore } from "./stores/interactionStore";
import { initializePaperStore } from "./stores/paperStore";
import { initializeSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { initializeSummaryStore } from "./stores/summaryStore";

/**
 * React Query クライアント
 *
 * サーバー状態管理（API呼び出し、キャッシュ）を担当
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5分間はキャッシュを新鮮とみなす
      staleTime: 5 * 60 * 1000,
      // バックグラウンドでの再フェッチを制御
      refetchOnWindowFocus: false,
    },
  },
});

/** 初期化がこの時間で終わらなければ、待機中の表示に切り替える */
const SLOW_INIT_MS = 10_000;

const INIT_SCREEN_TITLES: Record<InitScreenReason, string> = {
  failed: "起動エラー - Lumina",
  blocked: "起動待ち - Lumina",
  slow: "起動待ち - Lumina",
};

interface BootstrapOptions {
  db?: LuminaDB;
  reload?: () => void;
  /** 待機中の表示に切り替えるまでの時間（テスト用） */
  slowInitMs?: number;
}

/**
 * アプリを起動する
 *
 * ストアの初期化（IndexedDB の open を含む）に失敗したら、白い画面のまま止めずにエラー画面を描画する（Issue #87）。
 * 設定ストアの API key 暗号化移行の失敗はエラー画面にせず、起動を続ける。
 *
 * 保存済み論文は Web Worker で段階的に読み込み、全件の完了を待たずに描画する（Issue #65）。
 * 論文の読み込み失敗はエラー画面にせず、画面内の読み込み状態（再試行）で示す。
 *
 * 他のタブの接続が DB の upgrade を妨げている（blocked）ときや、初期化が一定時間で終わらないときは、
 * 白い画面のまま待たずに理由と復旧方法を表示する。初期化が終われば、その時点でアプリに切り替える（Issue #110）。
 * 起動後に他のタブが DB を更新しようとしたら（versionchange）、このタブの接続を閉じて再読み込みを促す。
 */
export const bootstrapApp = async (
  rootElement: HTMLElement,
  {
    db = luminaDb,
    reload = () => window.location.reload(),
    slowInitMs = SLOW_INIT_MS,
  }: BootstrapOptions = {}
): Promise<Root> => {
  const root = createRoot(rootElement);
  const appTitle = document.title;
  const renderInitScreen = (reason: InitScreenReason) => {
    document.title = INIT_SCREEN_TITLES[reason];
    root.render(
      <StrictMode>
        <InitErrorScreen reason={reason} pathname={window.location.pathname} onReload={reload} />
      </StrictMode>
    );
  };

  // 初期化を待つ間に blocked・時間切れになったら待機中の表示に切り替える。blocked の案内を時間切れで上書きしない
  let waitingReason: InitScreenReason | null = null;
  const showWaiting = (reason: InitScreenReason) => {
    if (waitingReason === "blocked") return;
    waitingReason = reason;
    renderInitScreen(reason);
  };
  const onBlocked = () => showWaiting("blocked");
  db.on("blocked", onBlocked);
  const slowTimer = setTimeout(() => showWaiting("slow"), slowInitMs);

  // アプリ起動前に Web Crypto を先にウォームアップしてから IndexedDB 初期化（リロード直後の検索で復号失敗しないよう）
  await warmupCrypto().catch(() => {});

  // 待たない（失敗しても reject せず paperStore の loadStatus に残る）
  void initializePaperStore(db);

  try {
    await Promise.all([
      initializeSummaryStore(db),
      initializeInteractionStore(db),
      initializeSearchHistoryStore(db),
      // 平文で保存されている API key を暗号化に移行する。
      // 失敗しても（crypto.subtle が無い等）IndexedDB とは無関係なので、平文のまま起動を続ける
      useSettingsStore
        .getState()
        .initializeStore()
        .catch((error: unknown) => {
          console.warn("Failed to migrate API key to encrypted storage", error);
        }),
    ]);
  } catch (error) {
    // 原因の調査用に開発者ツールには残す。画面にはメッセージもスタックも出さない
    console.error("Failed to initialize local data", error);
    renderInitScreen("failed");
    return root;
  } finally {
    clearTimeout(slowTimer);
    db.on.blocked.unsubscribe(onBlocked);
  }

  // 他のタブが DB を更新・削除しようとしたら、このタブの接続を閉じて妨げないようにする。
  // 次に DB を使うときは自動で開き直すが、このタブのコードは古い版のままなので再読み込みを促す
  db.on("versionchange", () => {
    db.close({ disableAutoOpen: false });
    toast.warning("別のタブで保存データの更新が始まりました", {
      id: "db-versionchange",
      description: "このタブの接続を閉じました。最新の状態で使うには再読み込みしてください。",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "再読み込み", onClick: reload },
    });
  });

  document.title = appTitle;
  root.render(
    <StrictMode>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <InteractionProvider>
            <App />
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{
                className: "font-sans",
                duration: 4000,
              }}
            />
          </InteractionProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>
  );
  return root;
};
