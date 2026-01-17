import { z } from "zod";
/**
 * arXiv論文のスキーマ
 */
export const PaperSchema = z.object({
    /** arXiv ID */
    id: z.string().min(1),
    /** 論文タイトル */
    title: z.string().min(1),
    /** アブストラクト */
    abstract: z.string(),
    /** 著者リスト */
    authors: z.array(z.string()),
    /** arXivカテゴリ */
    categories: z.array(z.string()),
    /** 公開日 */
    publishedAt: z.coerce.date(),
    /** 更新日 */
    updatedAt: z.coerce.date(),
    /** PDF URL */
    pdfUrl: z.string().url(),
    /** arXivページURL */
    arxivUrl: z.string().url(),
    /** Embeddingベクトル（1536次元） */
    embedding: z.array(z.number()).optional(),
});
/**
 * 論文要約のスキーマ
 *
 * @description
 * summary: 事実ベースの要約（この論文は何をしているか）
 * explanation: 読者ベースの説明（なぜあなたはこの論文を読むべきか）
 *
 * Context Engineering + "Why Your Writing Isn't Being Read" の教訓:
 * - 要約だけでは読者の興味を引けない
 * - 読者の問題から始まり、解決策を予告する説明文が必要
 */
export const PaperSummarySchema = z.object({
    /** 論文ID */
    paperId: z.string().min(1),
    /** 要約テキスト（事実ベース） */
    summary: z.string(),
    /** キーポイント */
    keyPoints: z.array(z.string()),
    /** 認知負荷最適化説明文（読者ベース、オプショナル） */
    explanation: z.string().optional(),
    /** 対象読者（オプショナル） */
    targetAudience: z.string().optional(),
    /** 読む理由（オプショナル） */
    whyRead: z.string().optional(),
    /** 言語 */
    language: z.enum(["ja", "en"]),
    /** 作成日時 */
    createdAt: z.coerce.date(),
});
