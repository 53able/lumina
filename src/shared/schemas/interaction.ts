import { z } from "zod";

/**
 * インタラクションタイプ
 */
export const InteractionTypeSchema = z.enum(["like", "bookmark", "view"]);

export type InteractionType = z.infer<typeof InteractionTypeSchema>;

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

export type UserInteraction = z.infer<typeof UserInteractionSchema>;

/**
 * インタラクション作成リクエスト
 */
export const CreateInteractionSchema = UserInteractionSchema.pick({
  paperId: true,
  type: true,
});

export type CreateInteraction = z.infer<typeof CreateInteractionSchema>;
