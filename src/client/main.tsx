import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { InteractionProvider } from "./contexts/InteractionContext";
import { luminaDb } from "./db/db";
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

// アプリ起動前にIndexedDBを初期化 + settingsStoreの移行
Promise.all([
  initializePaperStore(luminaDb),
  initializeSummaryStore(luminaDb),
  initializeInteractionStore(luminaDb),
  initializeSearchHistoryStore(luminaDb),
  // 平文で保存されている API key を暗号化に移行
  useSettingsStore
    .getState()
    .initializeStore(),
]).then(() => {
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
});
