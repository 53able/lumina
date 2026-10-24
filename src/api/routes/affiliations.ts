import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { ArxivHtmlError, fetchArxivHtml } from "../services/arxivHtml.js";
import type { AppEnv } from "../types/env.js";

const querySchema = z.object({
  paperId: z
    .string()
    .max(64)
    .regex(/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/),
});

export const affiliationsApp = new Hono<AppEnv>().get(
  "/affiliations",
  zValidator("query", querySchema),
  async (c) => {
    try {
      return c.json(await fetchArxivHtml(c.req.valid("query").paperId));
    } catch (error) {
      if (!(error instanceof ArxivHtmlError)) throw error;
      if (error.retryAfter) c.header("Retry-After", String(error.retryAfter));
      return c.json(
        {
          error:
            error.status === 404
              ? "この論文のHTML本文は公開されていません"
              : "所属情報の取得に失敗しました。しばらくしてから再試行してください",
        },
        error.status
      );
    }
  }
);
