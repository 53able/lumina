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

export type Paper = z.infer<typeof PaperSchema>;

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
  /**
   * キーポイントごとの根拠（keyPoints と同じ順序。生成時の Abstract に実在する文だけ）
   * 空配列のキーポイントと、この項目がない古い要約は「対応箇所未確認」として扱う。
   * 文との対応を示すだけで、キーポイントの正しさは保証しない
   */
  keyPointEvidence: z
    .array(z.array(z.object({ index: z.number().int().nonnegative(), text: z.string() })))
    .optional(),
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
  /**
   * 採用版か（同じ論文・言語の版のうち、表示に使う1件だけが true）
   * 未指定の版しかない既存データは、最新の版を採用版とみなす
   */
  adopted: z.boolean().optional(),
  /**
   * 利用者の訂正文（この版の要約本文への訂正。AI生成の各フィールドは書き換えない）
   * 版に付くため、再生成した新しい版には引き継がず、版を破棄すると一緒に消える
   */
  userCorrection: z
    .object({
      /** 訂正文 */
      text: z.string(),
      /** 最終保存日時 */
      updatedAt: z.coerce.date(),
    })
    .optional(),
});

/** 利用者の訂正文の最大文字数 */
export const SUMMARY_CORRECTION_MAX_LENGTH = 2000;

export type PaperSummary = z.infer<typeof PaperSummarySchema>;
