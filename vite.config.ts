import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import devServer from "@hono/vite-dev-server";

export default defineConfig(({ mode }) => {
  if (mode === "ssr") {
    return {
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          "@": resolve(import.meta.dirname, "./src"),
        },
      },
      build: {
        ssr: true,
        outDir: "dist",
        rollupOptions: {
          input: "src/api/app.tsx",
          output: {
            entryFileNames: "index.js",
          },
        },
      },
    };
  }

  return {
    plugins: [
      react({
        jsxRuntime: "automatic",
      }),
      tailwindcss(),
      devServer({
        entry: "src/api/app.tsx",
        exclude: [/^\/assets\/.+/, /^\/favicon\.ico$/, /^\/static\/.+/],
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      port: 3000,
    },
    build: {
      outDir: "dist",
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/client/main.tsx"),
        output: {
          assetFileNames: "assets/[name].[ext]",
          entryFileNames: "assets/index.js",
        },
      },
    },
    ssr: {
      noExternal: true,
    },
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["fake-indexeddb/auto", "./src/test/setup.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/PaperExplorer.test.tsx",
      ],
    },
  };
});
