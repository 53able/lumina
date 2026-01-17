import { z } from "zod";
/**
 * インタラクションタイプ
 */
export const InteractionTypeSchema = z.enum(["like", "bookmark", "view"]);
/**
 * ユーザーインタラクションのスキーマ
 */
export const UserInteractionSchema = z.object({
    /** ID */
    id: z.string().uuid(),
    /** 論文ID */
    paperId: z.string().min(1),
    /** インタラクションタイプ */
    type: InteractionTypeSchema,
    /** 作成日時 */
    createdAt: z.coerce.date(),
});
/**
 * インタラクション作成リクエスト
 */
export const CreateInteractionSchema = UserInteractionSchema.pick({
    paperId: true,
    type: true,
});
