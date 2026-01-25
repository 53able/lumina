import type { MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import type { Env } from "../types/env";

/**
 * レートリミットミドルウェアの作成
 *
 * すべてのAPIエンドポイント（/api/v1/*）にレートリミットを適用します。
 * デフォルト設定: 100リクエスト/15分
 *
 * @description
 * - クライアント識別: IPアドレスベース（x-forwarded-for, x-real-ip）
 * - ストレージ: MemoryStore（Vercel Edge Functions対応）
 * - 標準ヘッダー: draft-6形式のRateLimit-*ヘッダーを返す
 */
export const createRateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return rateLimiter({
    windowMs: 15 * 60 * 1000, // 15分
    limit: 100, // 100リクエスト
    keyGenerator: (c) => {
      // IPアドレスベースの識別
      // Vercelでは x-forwarded-for ヘッダーにIPアドレスが含まれる
      const forwardedFor = c.req.header("x-forwarded-for");
      if (forwardedFor) {
        // 複数のIPアドレスが含まれる場合、最初のものを使用
        return forwardedFor.split(",")[0]?.trim() || "unknown";
      }

      const realIp = c.req.header("x-real-ip");
      if (realIp) {
        return realIp;
      }

      // 開発環境などでIPアドレスが取得できない場合
      return "unknown";
    },
    standardHeaders: "draft-6", // 標準的なレートリミットヘッダー
    message: "Too many requests, please try again later.",
  });
};
