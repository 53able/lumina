/**
 * vercel.json の rewrites 検証（Issue #67）
 *
 * Vercel はファイルシステム（dist の静的ファイル）を rewrites より先に解決し、
 * その後 rewrites を定義順に評価して最初に一致したものを適用する。
 * ここではその順序を再現し、SPA の深いURLが index.html に、/api と /health が関数に届くことを確かめる。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Rewrite {
  source: string;
  destination: string;
}

const vercelJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf-8")
) as { rewrites: Rewrite[] };

/**
 * rewrite の source を正規表現に変換する。
 * このリポジトリで使う形（`:path*` と正規表現グループ）のみ扱う。
 */
const toRegExp = (source: string): RegExp =>
  new RegExp(`^${source.replace("/:path*", "(?:/.*)?")}$`);

/** dist に存在する静的ファイルの例 */
const staticFiles = new Set(["/index.html", "/lumina.svg", "/assets/index-abc123.js"]);

/** ファイルシステム → rewrites（定義順・最初の一致）の順で配信先を解決する */
const resolveDestination = (path: string): string | null => {
  if (staticFiles.has(path)) return path;
  const rewrite = vercelJson.rewrites.find((r) => toRegExp(r.source).test(path));
  return rewrite?.destination ?? null;
};

describe("vercel.json rewrites", () => {
  it.each([
    "/papers/2512.18131",
    "/papers/2512.18131v2",
    "/stats",
    "/",
  ])("%s は SPA の index.html を返す", (path) => {
    expect(resolveDestination(path)).toBe("/index.html");
  });

  it.each(["/api/v1/search", "/api/v1/x", "/api", "/health"])("%s は API 関数へ届く", (path) => {
    expect(resolveDestination(path)).toBe("/api");
  });

  it("存在する静的アセットはそのまま配信される", () => {
    expect(resolveDestination("/assets/index-abc123.js")).toBe("/assets/index-abc123.js");
    expect(resolveDestination("/lumina.svg")).toBe("/lumina.svg");
  });

  it("SPA フォールバックの正規表現は /api・/health・/assets を対象外にする", () => {
    const fallback = vercelJson.rewrites.find((r) => r.destination === "/index.html");
    expect(fallback).toBeDefined();
    const re = toRegExp(fallback?.source ?? "");

    expect(re.test("/papers/2512.18131")).toBe(true);
    expect(re.test("/healthcheck")).toBe(true);
    expect(re.test("/api/v1/x")).toBe(false);
    expect(re.test("/api")).toBe(false);
    expect(re.test("/health")).toBe(false);
    // 存在しない（古いハッシュの）アセットに HTML を返さない
    expect(re.test("/assets/index-old.js")).toBe(false);
  });
});
