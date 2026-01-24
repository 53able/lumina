import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { InitialData } from "../api/ssr/dataLoader.js";
import { App } from "./App.js";
import { ClientOnlyToaster } from "./components/ClientOnlyToaster.js";
import { InteractionProvider } from "./contexts/InteractionContext.js";
import { luminaDb } from "./db/db.js";
import { initializeInteractionStore } from "./stores/interactionStore.js";
import { initializePaperStore, usePaperStore } from "./stores/paperStore.js";
import { initializeSearchHistoryStore } from "./stores/searchHistoryStore.js";
import { useSettingsStore } from "./stores/settingsStore.js";
import { initializeSummaryStore } from "./stores/summaryStore.js";
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

/**
 * SSRから渡された初期データを取得
 */
const getInitialData = (): InitialData | undefined => {
  // @ts-expect-error - window.__INITIAL_DATA__ はSSRで設定される
  const data = window.__INITIAL_DATA__;
  return data;
};

/**
 * 初期データをIndexedDBに保存（SSRデータを優先）
 */
const hydrateInitialData = async (initialData: InitialData | undefined) => {
  if (!initialData) {
    return;
  }

  // 論文データをIndexedDBに保存
  if (initialData.papers && initialData.papers.length > 0) {
    await usePaperStore.getState().addPapers(initialData.papers);
  }

  // 個別論文データも保存（/papers/:id の場合）
  if (initialData.paper) {
    await usePaperStore.getState().addPaper(initialData.paper);
  }

  // サマリーデータはIndexedDBに保存しない（クライアント側で生成される）
};

// アプリ起動前にIndexedDBを初期化 + settingsStoreの移行 + 初期データのハイドレーション
const initialData = getInitialData();

// SSRされたHTMLがあるかどうかを判定（root要素に子要素がある場合）
const hasSSRContent = rootElement.children.length > 0;

Promise.all([
  initializePaperStore(luminaDb),
  initializeSummaryStore(luminaDb),
  initializeInteractionStore(luminaDb),
  initializeSearchHistoryStore(luminaDb),
  // 平文で保存されている API key を暗号化に移行
  useSettingsStore
    .getState()
    .initializeStore(),
  // SSRデータをIndexedDBに保存
  hydrateInitialData(initialData),
]).then(() => {
  const app = (
    <StrictMode>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <InteractionProvider>
            <App />
            <ClientOnlyToaster />
          </InteractionProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>
  );

  // SSRされたHTMLがある場合はハイドレーション、ない場合は通常レンダリング
  if (hasSSRContent) {
    try {
      hydrateRoot(rootElement, app);
    } catch (error) {
      throw error;
    }
  } else {
    // SSRされていない場合（フォールバック）
    createRoot(rootElement).render(app);
  }
});
