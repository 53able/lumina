import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

// .env.local を読み込む
const loadEnvFile = (filename: string) => {
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

loadEnvFile(".env");
loadEnvFile(".env.local");

const PORT = 3000;

const app = createApp();

console.log(`
🌟 Lumina API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server:    http://localhost:${PORT}
📖 API Docs:  http://localhost:${PORT}/api/ui
❤️  Health:    http://localhost:${PORT}/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

serve({
  fetch: app.fetch,
  port: PORT,
});
