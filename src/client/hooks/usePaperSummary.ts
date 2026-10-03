import {
  type MutationState,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { PaperSummary } from "../../shared/schemas/index";
import { type GenerateTarget, getDecryptedApiKey, summaryApi } from "../lib/api";
import { PartialSummaryError, toSummaryStageErrorCode } from "../lib/summaryErrorTypes";
import { getSummaryVersions, type SummaryVersion, useSummaryStore } from "../stores/summaryStore";

/**
 * usePaperSummary のオプション
 */
interface UsePaperSummaryOptions {
  /** 論文ID */
  paperId: string;
  /** 論文のアブストラクト */
  abstract: string;
  /**
   * エラー時のコールバック
   * paperId: 失敗した生成の論文ID（表示中の論文とは限らない）、target: 失敗した生成の対象
   */
  onError?: (error: Error, paperId: string, target: GenerateTarget) => void;
}

/** 要約生成の mutation 変数 */
interface GenerateVariables {
  paperId: string;
  language: "ja" | "en";
  target: GenerateTarget;
}

/** 要約生成の mutation を論文・言語をまたいで追跡するためのキー */
const SUMMARY_MUTATION_KEY = ["paperSummary", "generate"];

/** 要約生成の mutation の状態 */
type GenerationState = MutationState<PaperSummary, Error, GenerateVariables>;

/** 指定した論文・言語の要約生成の状態か（mutation cache の状態は型を持たないため、ここで絞り込む） */
const isGenerationFor = (
  state: MutationState,
  paperId: string,
  language: "ja" | "en"
): state is GenerationState => {
  const variables = state.variables as Partial<GenerateVariables> | undefined;
  return variables?.paperId === paperId && variables.language === language;
};

/**
 * usePaperSummary の戻り値
 */
interface UsePaperSummaryReturn {
  /** 現在の要約データ（表示中の論文・言語の採用版） */
  summary: SummaryVersion | undefined;
  /** 表示中の論文・言語の保存済みの版（古い順） */
  versions: SummaryVersion[];
  /** 版を採用版にする */
  adoptVersion: (id: number) => Promise<void>;
  /** 版を破棄する（採用版を破棄した場合は残りの最新の版が採用版になる） */
  discardVersion: (id: number) => Promise<void>;
  /** 版に利用者の訂正文を保存する（空なら訂正を削除する） */
  saveCorrection: (id: number, text: string) => Promise<void>;
  /** 選択中の言語 */
  summaryLanguage: "ja" | "en";
  /** 言語を切り替える */
  setSummaryLanguage: (language: "ja" | "en") => void;
  /** ローディング状態（表示中の論文・言語の生成のみ） */
  isLoading: boolean;
  /**
   * 直近の生成エラー（表示中の論文・言語のみ。次の生成開始でクリアされる）
   * 要約だけ保存できた部分成功の場合は PartialSummaryError になる
   * mutation cache から読むため、寿命は mutation の gcTime（既定5分）に依存する
   */
  error: Error | null;
  /**
   * 直近に失敗した生成の対象（error と同じ生成。失敗していなければ null）
   * "explanation" なら説明文だけの生成が失敗しており、保存済みの要約は残っている
   */
  failedTarget: GenerateTarget | null;
  /** 生成中の生成の対象（isLoading と同じ生成。生成中でなければ null） */
  generatingTarget: GenerateTarget | null;
  /**
   * 要約を生成する。同じ論文・言語の生成が実行中なら何もせずに返る
   * 失敗は error・onError で扱うため、この Promise は reject しない
   * @param language - 言語（省略時は summaryLanguage を使用）
   * @param target - 生成対象（デフォルト: "both"）
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
 * // 要約と説明文を生成
 * await generateSummary(undefined, "both");
 *
 * // 説明文のみ追加生成
 * await generateSummary(undefined, "explanation");
 * ```
 */
export const usePaperSummary = ({
  paperId,
  abstract,
  onError,
}: UsePaperSummaryOptions): UsePaperSummaryReturn => {
  const [summaryLanguage, setSummaryLanguage] = useState<"ja" | "en">("ja");

  const {
    summaries,
    getSummaryByPaperIdAndLanguage,
    addSummary,
    updateSummary,
    adoptSummary,
    discardSummary,
    saveCorrection,
  } = useSummaryStore();

  // 現在の論文・言語に対応するサマリー（採用版）と保存済みの版を取得
  const summary = getSummaryByPaperIdAndLanguage(paperId, summaryLanguage);
  const versions = useMemo(
    () => getSummaryVersions(summaries, paperId, summaryLanguage),
    [summaries, paperId, summaryLanguage]
  );

  const queryClient = useQueryClient();

  // React QueryのuseMutationでサマリー生成を管理（自動デデュープ・キャッシュ）
  const mutation = useMutation({
    mutationKey: SUMMARY_MUTATION_KEY,
    mutationFn: async ({ paperId, language, target }: GenerateVariables): Promise<PaperSummary> => {
      // API key を復号化して取得（早期開始パターン）
      const apiKeyPromise = getDecryptedApiKey();
      const apiKey = await apiKeyPromise;

      const response = await summaryApi(
        paperId,
        { language, abstract, generateTarget: target },
        { apiKey }
      );

      const normalizedData = normalizeSummaryResponse(response);

      // 説明文のみ生成の場合、既存の要約を維持して説明文だけを更新する
      const existingSummary = getSummaryByPaperIdAndLanguage(paperId, language);
      if (target === "explanation" && existingSummary) {
        const explanationFields = {
          explanation: normalizedData.explanation,
          targetAudience: normalizedData.targetAudience,
          whyRead: normalizedData.whyRead,
        };
        await updateSummary(paperId, language, explanationFields);
        return { ...existingSummary, ...explanationFields };
      }

      await addSummary(normalizedData);

      // 説明文の工程だけが失敗した場合: 成功済みの要約は保存したうえで、部分成功として失敗を返す
      const { explanationError } = response as {
        explanationError?: { code?: unknown; retryable?: unknown };
      };
      if (explanationError) {
        throw new PartialSummaryError(
          toSummaryStageErrorCode(explanationError.code),
          explanationError.retryable === true
        );
      }
      return normalizedData;
    },
    onError: (error, variables) => {
      const err = error instanceof Error ? error : new Error("要約の生成に失敗しました");
      onError?.(err, variables.paperId, variables.target);
    },
  });

  const { mutateAsync } = mutation;
  const generateSummary = useCallback(
    async (languageOverride?: "ja" | "en", target: GenerateTarget = "both") => {
      const language = languageOverride ?? summaryLanguage;
      // 同じ論文・言語の生成が実行中なら送らない（論文を行き来したときの二重送信防止）
      const isPending = queryClient
        .getMutationCache()
        .findAll({ mutationKey: SUMMARY_MUTATION_KEY, status: "pending" })
        .some((m) => isGenerationFor(m.state, paperId, language));
      if (isPending) return;
      // 失敗は mutation の状態（error）と onError で扱う。呼び出し側に reject を伝えない（未処理 rejection を防ぐ）
      await mutateAsync({ paperId, language, target }).catch(() => undefined);
    },
    [queryClient, paperId, summaryLanguage, mutateAsync]
  );

  // useMutation の状態は最後の生成しか追わないため、全生成から表示中の論文・言語の最新の生成を選ぶ
  const generations = useMutationState({
    filters: { mutationKey: SUMMARY_MUTATION_KEY },
    select: (m) => m.state,
  });
  const currentGeneration = generations
    .filter((state) => isGenerationFor(state, paperId, summaryLanguage))
    .at(-1);

  return {
    summary,
    versions,
    adoptVersion: adoptSummary,
    discardVersion: discardSummary,
    saveCorrection,
    summaryLanguage,
    setSummaryLanguage,
    isLoading: currentGeneration?.status === "pending",
    error: currentGeneration?.status === "error" ? currentGeneration.error : null,
    failedTarget:
      currentGeneration?.status === "error" ? (currentGeneration.variables?.target ?? null) : null,
    generatingTarget:
      currentGeneration?.status === "pending"
        ? (currentGeneration.variables?.target ?? null)
        : null,
    generateSummary,
  };
};
