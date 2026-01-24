import { defineConfig } from "tsup";

export default defineConfig({
  // エントリーポイント（Vercel Functions 用）
  entry: {
    index: "src/api/vercel-entry.ts",
  },
  // 出力先（Vercelの outputDirectory と合わせて dist/api/ に出力）
  outDir: "dist/api",
  // ESM 形式
  format: ["esm"],
  // Node.js 20 をターゲット
  target: "node20",
  platform: "node",
  // ソースマップなし（本番用）
  sourcemap: false,
  // クリーンビルド
  clean: true,
  // 型定義なし
  dts: false,
  // コード分割なし（単一ファイル）
  splitting: false,
  // すべての依存関係をバンドル
  bundle: true,
  // 外部パッケージ（node_modules）はバンドルしない
  noExternal: [/^\./, /^@\//, /^src\//],
  external: [
    "hono",
    "hono/*",
    "@hono/*",
    "@tanstack/*",
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
    "react-router",
    "react-router/*",
    "zod",
    "date-fns",
    "ai",
    "@ai-sdk/*",
    "lucide-react",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "@radix-ui/*",
    "sonner",
    "zustand",
    "dexie",
  ],
  // esbuild オプションで paths エイリアスを解決
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
