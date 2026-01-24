/**
 * Vercel Functions エントリーポイント
 *
 * tsup でバンドルされ、api/index.js として出力される。
 * Node.js Functionsで動作（react-dom/serverがNode.js APIに依存するため）。
 *
 * Node.js Functionsでは export default が必要。
 * export const GET などはEdge Functions用の形式。
 */
import { handle } from "@hono/node-server/vercel";
import { createApp } from "./app.js";

// #region agent log
const log = (msg, data = {}) => {
  fetch('http://127.0.0.1:7244/ingest/4c856d42-37db-45be-bf90-f3bccfe1e6a0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'src/api/vercel-entry.ts',
      message: msg,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'PQR'
    })
  }).catch(() => {});
  console.log(`[DEBUG] ${msg}`, JSON.stringify(data));
};
// #endregion

log('Vercel entry point loading');

const app = createApp();
log('App created');

const handler = handle(app);
log('Handler created');

export default (req, res) => {
  log('Request received', { method: req.method, url: req.url });
  try {
    return handler(req, res);
  } catch (err) {
    log('Handler error', { error: err.message, stack: err.stack });
    throw err;
  }
};

// 型エクスポート（RPCクライアント用）
export type { AppType } from "./app.js";
