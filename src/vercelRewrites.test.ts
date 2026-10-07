/**
 * vercel.json の rewrites 検証（Issue #67）
 *
 * Vercel と同じ @vercel/routing-utils で rewrites をルートへ変換し、
 * 生成された src（path-to-regexp の解釈結果）で一致を判定する。
 * Vercel はファイルシステム（dist の静的ファイル）を先に解決し（handle: "filesystem"）、
 * その後ルートを定義順に評価して最初に一致したものを適用する。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTransformedRoutes, type Rewrite } from "@vercel/routing-utils";
import { describe, expect, it } from "vitest";

const vercelJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../vercel.json"), "utf-8")
) as { rewrites: Rewrite[] };

const { routes, error } = getTransformedRoutes({ rewrites: vercelJson.rewrites });

/** filesystem ハンドルの後に並ぶ rewrite 由来のルート */
const rewriteRoutes = (routes ?? []).flatMap((route) =>
  "src" in route ? [{ src: new RegExp(route.src), dest: route.dest ?? "" }] : []
);

/** dist に存在する静的ファイルの例 */
const staticFiles = new Set(["/index.html", "/lumina.svg", "/assets/index-abc123.js"]);

/** ファイルシステム → rewrites（定義順・最初の一致）の順で配信先を解決する（クエリは除く） */
const resolveDestination = (path: string): string | null => {
  if (staticFiles.has(path)) return path;
  const route = rewriteRoutes.find((r) => r.src.test(path));
  return route ? route.dest.split("?")[0] : null;
};

describe("vercel.json rewrites", () => {
  it("Vercel のルート変換でエラーにならない", () => {
    expect(error).toBeNull();
    expect(routes?.[0]).toEqual({ handle: "filesystem" });
  });

  it.each([
    "/papers/2512.18131",
    "/papers/2512.18131v2",
    // 旧形式の ID（Issue #108）。スラッシュのまま・%2F のどちらでも SPA に届く
    "/papers/math.GT/0309136",
    "/papers/math.GT%2F0309136",
    "/stats",
    "/",
  ])("%s は SPA の index.html を返す", (path) => {
    expect(resolveDestination(path)).toBe("/index.html");
  });

  it.each([
    "/api/v1/search",
    "/api/v1/x",
    "/api/v1/summary/math.GT%2F0309136",
    "/api",
    "/health",
  ])("%s は API 関数へ届く", (path) => {
    expect(resolveDestination(path)).toBe("/api");
  });

  it("存在する静的アセットはそのまま配信される", () => {
    expect(resolveDestination("/assets/index-abc123.js")).toBe("/assets/index-abc123.js");
    expect(resolveDestination("/lumina.svg")).toBe("/lumina.svg");
  });

  it("存在しない（古いハッシュの）アセットには HTML を返さず 404 にする", () => {
    expect(resolveDestination("/assets/index-old.js")).toBeNull();
  });

  it("/health と完全一致しないパスは SPA に渡す（意図した挙動）", () => {
    // /health の rewrite は完全一致のみ。/health/ や /healthcheck は API ではなくアプリの画面になる
    expect(resolveDestination("/health/")).toBe("/index.html");
    expect(resolveDestination("/healthcheck")).toBe("/index.html");
  });
});
