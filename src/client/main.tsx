import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { luminaDb } from "./db/db";
import { warmupCrypto } from "./lib/crypto";
import { initializeInteractionStore } from "./stores/interactionStore";
import { initializePaperStore } from "./stores/paperStore";
import { initializeSearchHistoryStore } from "./stores/searchHistoryStore";
import { useSettingsStore } from "./stores/settingsStore";
import { initializeSummaryStore } from "./stores/summaryStore";
import "./index.css";

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

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

/** React を描画する（保存済み論文の読み込み完了を待たない） */
const renderApp = () => {
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

/**
 * 小さいストア（要約・操作記録・検索履歴・設定）を初期化する。
 * 失敗しても描画は止めない（白画面にしない）。失敗はログに残す。
 */
const initializeSmallStores = async (): Promise<void> => {
  const results = await Promise.allSettled([
    initializeSummaryStore(luminaDb),
    initializeInteractionStore(luminaDb),
    initializeSearchHistoryStore(luminaDb),
    // 平文で保存されている API key を暗号化に移行
    useSettingsStore
      .getState()
      .initializeStore(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to initialize store:", result.reason);
    }
  }
};

// アプリ起動前に Web Crypto を先にウォームアップしてから IndexedDB 初期化（リロード直後の検索で復号失敗しないよう）
// 保存済み論文は Web Worker で段階的に読み込み、全件の完了を待たずに描画する（読み込み状態は画面で表示する）
warmupCrypto()
  .catch(() => {})
  .then(() => {
    void initializePaperStore(luminaDb);
    return initializeSmallStores();
  })
  .catch((err: unknown) => {
    console.error("Failed to initialize stores:", err);
  })
  .then(renderApp);
