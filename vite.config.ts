import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react({
      // JSXの自動検出を有効化（React 17+）
      jsxRuntime: "automatic",
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  // Note: proxy設定は不要（ViteミドルウェアモードでHonoと統合済み）
  // dev:viteコマンドでVite単体起動時のポート設定
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // SSR対応: index.html を使わずクライアントJSのみビルド
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/client/main.tsx"),
      output: {
        // 静的アセットを /assets に出力
        assetFileNames: "assets/[name].[ext]",
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["fake-indexeddb/auto", "./src/test/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // FIXME: jsdom環境でハングするため一時的に除外
      "**/PaperExplorer.test.tsx",
    ],
  },
});
