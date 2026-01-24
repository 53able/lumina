import { defineConfig } from "tsup";

export default defineConfig({
  // エントリーポイント（Vercel Functions 用）
  entry: {
    index: "src/api/vercel-entry.ts",
  },
  // 出力先（api/ ディレクトリに直接出力）
  outDir: "api",
  // CJS 形式
  format: ["cjs"],
  // Node.js 20 をターゲット
  target: "node20",
  platform: "node",
  // ソースマップなし（本番用）
  sourcemap: false,
  // クリーンビルドは無効（api/package.json を保持するため）
  clean: false,
  // 型定義なし
  dts: false,
  // 拡張子を .js に固定（ビルドスクリプトとの互換性のため）
  outExtension() {
    return {
      js: ".js",
    };
  },
  // コード分割なし（単一ファイル）
  splitting: false,
  // すべての依存関係をバンドル（Vercel Functions用）
  bundle: true,
  // すべてのパッケージをバンドルに含める
  noExternal: [/.*/],
  // Node.js 組み込みモジュールを外部化（ESMバンドルで require エラーを避けるため）
  external: [
    "util",
    "crypto",
    "stream",
    "async_hooks",
    "events",
    "buffer",
    "path",
    "fs",
    "url",
    "http",
    "https",
    "zlib",
    "node:util",
    "node:crypto",
    "node:stream",
    "node:async_hooks",
    "node:events",
    "node:buffer",
    "node:path",
    "node:fs",
    "node:url",
    "node:http",
    "node:https",
    "node:zlib",
  ],
  // esbuild オプションで paths エイリアスを解決
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
