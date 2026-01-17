import { z } from "zod";
/**
 * arXivカテゴリのスキーマ
 */
export const CategorySchema = z.object({
    /** カテゴリID (例: "cs.AI") */
    id: z.string().min(1),
    /** カテゴリ名 (例: "Artificial Intelligence") */
    name: z.string().min(1),
    /** グループ名 (例: "Computer Science") */
    group: z.string().min(1),
    /** デフォルトで選択されているか */
    isDefault: z.boolean().default(false),
});
/**
 * カテゴリ一覧レスポンスのスキーマ
 */
export const CategoryListResponseSchema = z.object({
    /** カテゴリ一覧 */
    categories: z.array(CategorySchema),
    /** デフォルト選択されているカテゴリのID */
    defaultCategoryIds: z.array(z.string()),
});
