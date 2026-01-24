#!/usr/bin/env node
/**
 * Vercel Build Output API 用のビルドスクリプト
 *
 * .vercel/output/ に以下の構造を作成する:
 * - config.json: ルーティング設定
 * - static/: 静的ファイル（Vite ビルド出力）
 * - functions/api.func/: Serverless Function
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, ".vercel/output");

// 出力ディレクトリをクリーンアップ
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true });
}

// ディレクトリ構造を作成
mkdirSync(join(outputDir, "static/assets"), { recursive: true });
mkdirSync(join(outputDir, "functions/api.func"), { recursive: true });

// 1. config.json を作成
const config = {
  version: 3,
  routes: [
    // 静的アセット
    {
      src: "/assets/(.*)",
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    },
    // API ルート
    { src: "/api/(.*)", dest: "/api" },
    { src: "/health", dest: "/api" },
    // その他すべてのリクエストを API（SSR）にルーティング
    { src: "/(.*)", dest: "/api" },
  ],
};

writeFileSync(join(outputDir, "config.json"), JSON.stringify(config, null, 2));

// 2. 静的ファイルをコピー（dist/ → static/）
cpSync(join(rootDir, "dist"), join(outputDir, "static"), { recursive: true });

// public/ の既存ファイル（lumina.svg）もコピー
cpSync(join(rootDir, "public/lumina.svg"), join(outputDir, "static/lumina.svg"));

// 3. Function をコピー
cpSync(join(rootDir, "api/index.js"), join(outputDir, "functions/api.func/index.js"));

// 4. Function の設定ファイルを作成（Edge Functions）
const funcConfig = {
  runtime: "edge",
  entrypoint: "index.js",
};

writeFileSync(
  join(outputDir, "functions/api.func/.vc-config.json"),
  JSON.stringify(funcConfig, null, 2)
);

// 5. Function の package.json を作成（ESM サポート用）
const funcPackageJson = {
  type: "module",
};

writeFileSync(
  join(outputDir, "functions/api.func/package.json"),
  JSON.stringify(funcPackageJson, null, 2)
);

console.log("✅ Build Output created at .vercel/output/");
