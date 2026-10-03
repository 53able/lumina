import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { InitErrorScreen } from "./components/InitErrorScreen";
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

interface BootstrapOptions {
  db?: LuminaDB;
  reload?: () => void;
}

/**
 * アプリを起動する
 *
 * ストアの初期化（IndexedDB の open を含む）に失敗したら、白い画面のまま止めずにエラー画面を描画する（Issue #87）。
 */
export const bootstrapApp = async (
  rootElement: HTMLElement,
  { db = luminaDb, reload = () => window.location.reload() }: BootstrapOptions = {}
): Promise<void> => {
  // アプリ起動前に Web Crypto を先にウォームアップしてから IndexedDB 初期化（リロード直後の検索で復号失敗しないよう）
  await warmupCrypto().catch(() => {});

  try {
    await Promise.all([
      initializePaperStore(db),
      initializeSummaryStore(db),
      initializeInteractionStore(db),
      initializeSearchHistoryStore(db),
      // 平文で保存されている API key を暗号化に移行
      useSettingsStore
        .getState()
        .initializeStore(),
    ]);
  } catch (error) {
    // 原因の調査用に開発者ツールには残す。画面にはメッセージもスタックも出さない
    console.error("Failed to initialize local data", error);
    createRoot(rootElement).render(
      <StrictMode>
        <InitErrorScreen pathname={window.location.pathname} onReload={reload} />
      </StrictMode>
    );
    return;
  }

  createRoot(rootElement).render(
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
};
