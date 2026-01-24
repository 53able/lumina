import { defineConfig } from "tsup";

export default defineConfig({
  // エントリーポイント（Vercel Functions 用）
  entry: {
    index: "src/api/vercel-entry.ts",
  },
  // 出力先（api/ ディレクトリに直接出力）
  outDir: "api",
  // ESM 形式
  format: ["esm"],
  // Node.js 20 をターゲット
  target: "node20",
  platform: "node",
  // ソースマップなし（本番用）
  sourcemap: false,
  // クリーンビルドは無効（api/package.json を保持するため）
  clean: false,
  // 型定義なし
  dts: false,
  // コード分割なし（単一ファイル）
  splitting: false,
  // すべての依存関係をバンドル（Vercel Functions用）
  bundle: true,
  // すべてのパッケージをバンドルに含める
  noExternal: [/.*/],
  // Node.js 組み込みモジュールのみ外部化
  external: [],
  // esbuild オプションで paths エイリアスを解決
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
