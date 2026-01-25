import { describe, expect, it } from "vitest";
import { createApp } from "../app";

describe("レートリミットミドルウェア", () => {
  const app = createApp();

  describe("正常系: 通常のリクエスト", () => {
    it("通常のリクエストは成功する", async () => {
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": "192.168.1.1",
        },
      });

      const response = await app.request(request);

      expect(response.status).toBe(200);
    });

    it("レートリミットヘッダーが含まれる", async () => {
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": "192.168.1.1",
        },
      });

      const response = await app.request(request);

      // draft-6形式のヘッダーを確認
      expect(response.headers.get("RateLimit-Limit")).toBe("100");
      expect(response.headers.get("RateLimit-Remaining")).toBeTruthy();
      expect(response.headers.get("RateLimit-Reset")).toBeTruthy();
    });
  });

  describe("異常系: レートリミット超過", () => {
    it("100リクエストを超えると429エラーを返す", async () => {
      const testIp = "192.168.1.100";

      // 100リクエストまで送信（正常に処理される）
      for (let i = 0; i < 100; i++) {
        const request = new Request("http://localhost/api/v1/categories", {
          method: "GET",
          headers: {
            "x-forwarded-for": testIp,
          },
        });

        const response = await app.request(request);
        expect(response.status).toBe(200);
      }

      // 101回目のリクエスト（レートリミット超過）
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": testIp,
        },
      });

      const response = await app.request(request);

      expect(response.status).toBe(429);
      // レスポンスがJSONかテキストかを確認
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await response.json();
        expect(body.error || body.message).toBe("Too many requests, please try again later.");
      } else {
        const body = await response.text();
        expect(body).toContain("Too many requests");
      }
    });

    it("レートリミット超過時は適切なヘッダーを返す", async () => {
      const testIp = "192.168.1.200";

      // 100リクエスト送信
      for (let i = 0; i < 100; i++) {
        const request = new Request("http://localhost/api/v1/categories", {
          method: "GET",
          headers: {
            "x-forwarded-for": testIp,
          },
        });
        await app.request(request);
      }

      // 101回目のリクエスト
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": testIp,
        },
      });

      const response = await app.request(request);

      expect(response.status).toBe(429);
      expect(response.headers.get("RateLimit-Limit")).toBe("100");
      expect(response.headers.get("RateLimit-Remaining")).toBe("0");
    });
  });

  describe("クライアント識別", () => {
    it("異なるIPアドレスは独立してカウントされる", async () => {
      const ip1 = "192.168.1.10";
      const ip2 = "192.168.1.20";

      // IP1で100リクエスト送信
      for (let i = 0; i < 100; i++) {
        const request = new Request("http://localhost/api/v1/categories", {
          method: "GET",
          headers: {
            "x-forwarded-for": ip1,
          },
        });
        await app.request(request);
      }

      // IP2のリクエストはまだ成功する（独立したカウント）
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": ip2,
        },
      });

      const response = await app.request(request);
      expect(response.status).toBe(200);
    });

    it("IPアドレスがない場合はunknownとして扱われる", async () => {
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        // IPアドレスヘッダーなし
      });

      const response = await app.request(request);

      // 正常に処理される（unknownとして1つのクライアントとして扱われる）
      expect(response.status).toBe(200);
    });
  });

  describe("適用範囲", () => {
    it("/healthエンドポイントはレートリミットの対象外", async () => {
      // /healthエンドポイントに大量のリクエストを送信
      for (let i = 0; i < 150; i++) {
        const request = new Request("http://localhost/health", {
          method: "GET",
          headers: {
            "x-forwarded-for": "192.168.1.1",
          },
        });

        const response = await app.request(request);
        // レートリミットが適用されないため、すべて成功する
        expect(response.status).toBe(200);
      }
    });

    it("/api/v1/*パスにはレートリミットが適用される", async () => {
      const testIp = "192.168.1.300";

      // 100リクエストまで正常
      for (let i = 0; i < 100; i++) {
        const request = new Request("http://localhost/api/v1/categories", {
          method: "GET",
          headers: {
            "x-forwarded-for": testIp,
          },
        });

        const response = await app.request(request);
        expect(response.status).toBe(200);
      }

      // 101回目でレートリミット
      const request = new Request("http://localhost/api/v1/categories", {
        method: "GET",
        headers: {
          "x-forwarded-for": testIp,
        },
      });

      const response = await app.request(request);
      expect(response.status).toBe(429);
    });
  });
});
