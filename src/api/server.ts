import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import { createApp } from "./app.js";

/**
 * .envファイルを読み込んで環境変数に設定
 *
 * @param filename - 読み込むファイル名
 */
const loadEnvFile = (filename: string): void => {
  try {
    const envFile = readFileSync(resolve(process.cwd(), filename), "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex);
          const value = trimmed.slice(eqIndex + 1);
          process.env[key] = value;
        }
      }
    }
  } catch {
    // ファイルが存在しない場合は無視
  }
};

/**
 * IncomingMessageからWeb標準のRequestを作成
 *
 * @param req - Node.jsのIncomingMessage
 * @param port - サーバーのポート番号
 * @returns Web標準のRequest
 */
const createWebRequest = (req: IncomingMessage, port: number): Request => {
  const url = `http://localhost:${port}${req.url ?? "/"}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    body: hasBody ? req : undefined,
    // @ts-expect-error - Node.js 18+ supports duplex option
    duplex: hasBody ? "half" : undefined,
  });
};

/**
 * Web標準のResponseをNode.jsのServerResponseに書き込み
 *
 * @param response - Web標準のResponse
 * @param res - Node.jsのServerResponse
 */
const writeWebResponse = async (response: Response, res: ServerResponse): Promise<void> => {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
};

/**
 * 開発サーバーの起動
 *
 * Viteミドルウェアモードを使用して、単一サーバーでHMRとSSRを統合。
 * - Viteがアセット配信とHMRを担当
 * - Honoが API と SSR を担当
 */
const startDevServer = async (): Promise<void> => {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const PORT = 3000;

  // Viteを動的インポート（開発環境専用）
  const { createServer: createViteServer } = await import("vite");

  const vite: ViteDevServer = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
  });

  // Honoアプリを作成（Vite経由のアセットパスを使用）
  const app = createApp({
    assets: {
      css: ["/src/client/index.css"],
      js: ["/src/client/main.tsx"],
    },
  });

  const server = createServer((req, res) => {
    // Viteミドルウェアを先に通す（アセット、HMR、クライアントコードの変換）
    vite.middlewares(req, res, async () => {
      // Viteが処理しなかったリクエストはHonoで処理（API、SSR）
      try {
        const request = createWebRequest(req, PORT);
        const response = await app.fetch(request);
        await writeWebResponse(response, res);
      } catch (error) {
        console.error("[Server] Error handling request:", error);
        vite.ssrFixStacktrace(error as Error);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`
🌟 Lumina Dev Server (Vite + Hono SSR)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server:    http://localhost:${PORT}
📖 API Docs:  http://localhost:${PORT}/api/ui
❤️  Health:    http://localhost:${PORT}/health
🌐 SSR:       http://localhost:${PORT}/*
⚡ HMR:       Enabled (via Vite middleware)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  });
};

startDevServer().catch((error) => {
  console.error("Failed to start dev server:", error);
  process.exit(1);
});
