import { useCallback, useState } from "react";
import { type GenerateTarget, getDecryptedApiKey, summaryApi } from "../lib/api";
import { useSummaryStore } from "../stores/summaryStore";
import type { PaperSummary } from "../../shared/schemas/index";

/**
 * usePaperSummary のオプション
 */
interface UsePaperSummaryOptions {
  /** 論文ID */
  paperId: string;
  /** 論文のアブストラクト */
  abstract: string;
  /** エラー時のコールバック */
  onError?: (error: Error) => void;
}

/**
 * usePaperSummary の戻り値
 */
interface UsePaperSummaryReturn {
  /** 現在の要約データ */
  summary: PaperSummary | undefined;
  /** 選択中の言語 */
  summaryLanguage: "ja" | "en";
  /** 言語を切り替える */
  setSummaryLanguage: (language: "ja" | "en") => void;
  /** ローディング状態 */
  isLoading: boolean;
  /**
   * 要約を生成する
   * @param language - 言語（省略時は summaryLanguage を使用）
   * @param target - 生成対象（デフォルト: "summary"）
   */
  generateSummary: (language?: "ja" | "en", target?: GenerateTarget) => Promise<void>;
}

/**
 * APIレスポンスの日付を正規化する
 *
 * Hono RPC の型推論では Date として扱われるが、
 * 実際の JSON レスポンスでは ISO 文字列として返ってくるため変換が必要
 */
const normalizeSummaryResponse = (data: Awaited<ReturnType<typeof summaryApi>>): PaperSummary => ({
  paperId: data.paperId,
  summary: data.summary,
  keyPoints: data.keyPoints,
  language: data.language,
  createdAt: new Date(data.createdAt as unknown as string),
  explanation:
    "explanation" in data && typeof data.explanation === "string" ? data.explanation : undefined,
  targetAudience:
    "targetAudience" in data && typeof data.targetAudience === "string"
      ? data.targetAudience
      : undefined,
  whyRead: "whyRead" in data && typeof data.whyRead === "string" ? data.whyRead : undefined,
});

/**
 * usePaperSummary - 論文要約の生成と管理
 *
 * 責務:
 * - サマリー言語状態の管理
 * - ローディング状態の管理
 * - API呼び出しとレスポンス正規化
 * - 既存サマリーとのマージロジック
 *
 * @example
 * ```tsx
 * const { summary, summaryLanguage, isLoading, generateSummary, setSummaryLanguage } =
 *   usePaperSummary({
 *     paperId: paper.id,
 *     abstract: paper.abstract,
 *     onError: (err) => toast.error(err.message),
 *   });
 *
 * // 要約生成
 * await generateSummary("summary");
 *
 * // 説明文のみ追加生成
 * await generateSummary("explanation");
 * ```
 */
export const usePaperSummary = ({
  paperId,
  abstract,
  onError,
}: UsePaperSummaryOptions): UsePaperSummaryReturn => {
  const [summaryLanguage, setSummaryLanguage] = useState<"ja" | "en">("ja");
  const [isLoading, setIsLoading] = useState(false);

  const { getSummaryByPaperIdAndLanguage, addSummary } = useSummaryStore();

  // 現在の論文・言語に対応するサマリーを取得
  const summary = getSummaryByPaperIdAndLanguage(paperId, summaryLanguage);

  const generateSummary = useCallback(
    async (languageOverride?: "ja" | "en", target: GenerateTarget = "summary") => {
      const language = languageOverride ?? summaryLanguage;
      setIsLoading(true);

      try {
        // API key を復号化して取得
        const apiKey = await getDecryptedApiKey();

        const response = await summaryApi(
          paperId,
          { language, abstract, generateTarget: target },
          { apiKey }
        );

        const normalizedData = normalizeSummaryResponse(response);

        // 説明文のみ生成の場合、既存の要約を維持してマージ
        const existingSummary = getSummaryByPaperIdAndLanguage(paperId, language);
        const mergedSummary: PaperSummary =
          target === "explanation" && existingSummary
            ? {
                ...existingSummary,
                explanation: normalizedData.explanation,
                targetAudience: normalizedData.targetAudience,
                whyRead: normalizedData.whyRead,
              }
            : normalizedData;

        await addSummary(mergedSummary);
      } catch (error) {
        const err = error instanceof Error ? error : new Error("要約の生成に失敗しました");
        onError?.(err);
      } finally {
        setIsLoading(false);
      }
    },
    [paperId, summaryLanguage, abstract, getSummaryByPaperIdAndLanguage, addSummary, onError]
  );

  return {
    summary,
    summaryLanguage,
    setSummaryLanguage,
    isLoading,
    generateSummary,
  };
};
