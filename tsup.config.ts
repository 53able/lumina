import { defineConfig } from "tsup";

export default defineConfig({
  // エントリーポイント（Vercel Functions 用）
  entry: {
    index: "src/api/vercel-entry.ts",
  },
  // 出力先（Vercel Serverless Functions はルートの api/ を参照）
  outDir: "api",
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
