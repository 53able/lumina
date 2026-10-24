import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Logger } from "../lib/logger.js";
import type { AppEnv } from "../types/env.js";

/** reqId に使える x-vercel-id の形（英数字と : _ - で128文字まで）。合わなければ UUID にする */
const VERCEL_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
/** path を切る長さ */
const MAX_PATH_LENGTH = 256;

/**
 * リクエストごとに reqId 付きの子ロガーを Context に設定し、応答後にアクセスログを1行出す
 * - reqId: x-vercel-id が VERCEL_ID_PATTERN に合えばその値。なければ・合わなければ UUID
 * - path は256文字まで
 * - アクセスログは常に info（重要度はルートと onError の行に持たせる）
 * - クエリ文字列・ヘッダー・本文は出さない
 */
export const requestLogger =
  (baseLogger: Logger): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const startedAt = performance.now();
    const vercelId = c.req.header("x-vercel-id");
    const reqId =
      vercelId !== undefined && VERCEL_ID_PATTERN.test(vercelId) ? vercelId : crypto.randomUUID();
    const logger = baseLogger.child({ reqId });
    c.set("logger", logger);

    await next();

    logger.info(
      {
        method: c.req.method,
        route: routePath(c),
        path: c.req.path.slice(0, MAX_PATH_LENGTH),
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "request"
    );
  };
