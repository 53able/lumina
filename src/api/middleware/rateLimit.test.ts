import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { getClientKey } from "./rateLimit";

/** 汎用バケット（/api/v1/* のうち sync 以外）の上限 */
const API_LIMIT = 600;
/** sync バケット（/api/v1/sync）の上限 */
const SYNC_LIMIT = 12;

describe("レートリミットミドルウェア", () => {
  const app = createApp();

  /** 汎用バケットで数えられる GET /api/v1/categories を送る */
  const requestCategories = (ip?: string) =>
    app.request(
      new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: ip ? { "x-forwarded-for": ip } : {},
      })
    );

  /** sync バケットで数えられる POST /api/v1/sync を送る（本文が不正なため arXiv は呼ばれず 400 になる） */
  const requestSync = (ip: string) =>
    app.request(
      new Request("http://localhost/api/v1/sync", {
        method: "POST",
        headers: { "x-forwarded-for": ip, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

  /** 429 応答が JSON 本文と Retry-After を持つことを検証する */
  const expectRateLimitResponse = async (response: Response) => {
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: "Too many requests, please try again later.",
      code: "rate_limit",
      retryable: true,
    });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response.headers.get("RateLimit-Remaining")).toBe("0");
  };

  describe("正常系: 通常のリクエスト", () => {
    it("通常のリクエストは成功する", async () => {
      const response = await requestCategories("192.168.1.1");

      expect(response.status).toBe(200);
    });

    it("汎用 API には 600 件のレートリミットヘッダーが含まれる", async () => {
      const response = await requestCategories("192.168.1.1");

      // draft-6形式のヘッダーを確認
      expect(response.headers.get("RateLimit-Limit")).toBe(String(API_LIMIT));
      expect(response.headers.get("RateLimit-Remaining")).toBeTruthy();
      expect(response.headers.get("RateLimit-Reset")).toBeTruthy();
    });

    it("sync には 12 件/60 秒のレートリミットヘッダーが含まれる", async () => {
      const response = await requestSync("192.168.1.2");

      expect(response.headers.get("RateLimit-Limit")).toBe(String(SYNC_LIMIT));
      expect(response.headers.get("RateLimit-Policy")).toBe(`${SYNC_LIMIT};w=60`);
    });
  });

  describe("異常系: レートリミット超過", () => {
    it("汎用 API は 600 リクエストを超えると JSON 本文と Retry-After 付きの 429 を返す", async () => {
      const testIp = "192.168.1.100";

      for (let i = 0; i < API_LIMIT; i++) {
        const response = await requestCategories(testIp);
        expect(response.status).toBe(200);
      }

      await expectRateLimitResponse(await requestCategories(testIp));
    });

    it("sync は 12 リクエストを超えると JSON 本文と Retry-After 付きの 429 を返す", async () => {
      const testIp = "192.168.1.101";

      for (let i = 0; i < SYNC_LIMIT; i++) {
        const response = await requestSync(testIp);
        expect(response.status).toBe(400);
      }

      await expectRateLimitResponse(await requestSync(testIp));
    });
  });

  describe("バケットの独立性", () => {
    it("sync が上限に達しても汎用 API は成功し、sync の分は汎用バケットで数えない", async () => {
      const testIp = "192.168.1.110";

      for (let i = 0; i < SYNC_LIMIT + 1; i++) {
        await requestSync(testIp);
      }

      const response = await requestCategories(testIp);
      expect(response.status).toBe(200);
      expect(response.headers.get("RateLimit-Remaining")).toBe(String(API_LIMIT - 1));
    });

    it("汎用 API が上限に達しても sync は 429 にならない", async () => {
      const testIp = "192.168.1.111";

      for (let i = 0; i < API_LIMIT + 1; i++) {
        await requestCategories(testIp);
      }

      const response = await requestSync(testIp);
      expect(response.status).toBe(400);
      expect(response.headers.get("RateLimit-Remaining")).toBe(String(SYNC_LIMIT - 1));
    });
  });

  describe("クライアント識別", () => {
    it("異なるIPアドレスは独立してカウントされる", async () => {
      const ip1 = "192.168.1.10";
      const ip2 = "192.168.1.20";

      for (let i = 0; i < API_LIMIT; i++) {
        await requestCategories(ip1);
      }

      // IP2のリクエストはまだ成功する（独立したカウント）
      const response = await requestCategories(ip2);
      expect(response.status).toBe(200);
    });

    it("IPアドレスがない場合はunknownとして扱われる", async () => {
      const response = await requestCategories();

      // 正常に処理される（unknownとして1つのクライアントとして扱われる）
      expect(response.status).toBe(200);
    });
  });

  describe("適用範囲", () => {
    it("/healthエンドポイントはレートリミットの対象外", async () => {
      for (let i = 0; i < 150; i++) {
        const response = await app.request(
          new Request("http://localhost/health", {
            method: "GET",
            headers: { "x-forwarded-for": "192.168.1.1" },
          })
        );
        // レートリミットが適用されないため、すべて成功する
        expect(response.status).toBe(200);
        expect(response.headers.get("RateLimit-Limit")).toBeNull();
      }
    });
  });

  describe("getClientKey", () => {
    const keyApp = new Hono().get("/", (c) => c.text(getClientKey(c)));
    const keyOf = async (headers: Record<string, string>) =>
      (await keyApp.request("http://localhost/", { headers })).text();

    it("x-real-ip を x-forwarded-for より優先する", async () => {
      expect(await keyOf({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1" })).toBe(
        "203.0.113.5"
      );
    });

    it("x-real-ip が無ければ x-forwarded-for の先頭を使う", async () => {
      expect(await keyOf({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })).toBe("198.51.100.1");
    });

    it("どちらも無ければ unknown", async () => {
      expect(await keyOf({})).toBe("unknown");
    });

    it("IPv6 は /64 にまとめ、:: 省略形を展開して同じキーにする", async () => {
      const full = await keyOf({ "x-real-ip": "2001:0db8:0000:0000:0000:0000:0000:0001" });
      expect(full).toBe("2001:db8:0:0::/64");
      expect(await keyOf({ "x-real-ip": "2001:db8::1" })).toBe(full);
      expect(await keyOf({ "x-real-ip": "2001:db8::ffff:1:2" })).toBe(full);
      expect(await keyOf({ "x-real-ip": "2001:db8:0:1::1" })).toBe("2001:db8:0:1::/64");
      expect(await keyOf({ "x-real-ip": "2001:db8:1:2:3:4:5:6" })).toBe("2001:db8:1:2::/64");
      expect(await keyOf({ "x-real-ip": "fe80::1%eth0" })).toBe("fe80:0:0:0::/64");
      expect(await keyOf({ "x-real-ip": "::1" })).toBe("0:0:0:0::/64");
    });

    it("ポート付きの IPv4 はポートを除いてキーにする", async () => {
      expect(await keyOf({ "x-real-ip": "203.0.113.5:5678" })).toBe("203.0.113.5");
    });

    it("IPv4 埋め込みの IPv6 は IPv4 として扱う", async () => {
      expect(await keyOf({ "x-real-ip": "::ffff:203.0.113.5" })).toBe("203.0.113.5");
    });
  });
});
