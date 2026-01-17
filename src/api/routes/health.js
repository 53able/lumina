import { createRoute, z } from "@hono/zod-openapi";
/**
 * ヘルスチェックのレスポンススキーマ
 */
export const HealthResponseSchema = z.object({
    status: z.literal("ok"),
    timestamp: z.string().datetime(),
});
/**
 * ヘルスチェックエンドポイント
 */
export const healthRoute = createRoute({
    method: "get",
    path: "/health",
    tags: ["system"],
    summary: "ヘルスチェック",
    description: "APIサーバーの稼働状態を確認します",
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: HealthResponseSchema,
                },
            },
            description: "サーバーは正常に稼働中",
        },
    },
});
