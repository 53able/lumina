import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // 論文索引の Web Worker（src/client/workers）は同一オリジンの別ファイル（ES モジュール）として出力する
  worker: {
    format: "es",
  },
  test: {
    globals: true,
    environment: "node",
    // パッケージ名のままだと vitest は root（末尾の / なし）の親ディレクトリを起点に解決するため、
    // リポジトリ配下の git worktree では親リポジトリの node_modules を指して読み込めない。絶対パスで渡す
    setupFiles: [fileURLToPath(import.meta.resolve("fake-indexeddb/auto")), "./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
