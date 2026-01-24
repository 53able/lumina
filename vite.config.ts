import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import devServer from "@hono/vite-dev-server";

export default defineConfig({
  plugins: [
    react({
      // JSXの自動検出を有効化（React 17+）
      jsxRuntime: "automatic",
    }),
    tailwindcss(),
    devServer({
      entry: "src/api/app.ts",
      exclude: [/^\/assets\/.+/, /^\/favicon\.ico$/, /^\/static\/.+/],
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  // dev:viteコマンドでVite単体起動時のポート設定
  server: {
    port: 3000,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // SSR対応: クライアント側のビルドのみ
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/client/main.tsx"),
      output: {
        // 静的アセットを /assets に出力
        assetFileNames: "assets/index.[ext]",
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
