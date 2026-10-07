import { create } from "zustand";

/**
 * 要約生成のタブ間の排他（Issue #128）
 *
 * 2つのタブで同じ論文・言語の要約生成をほぼ同時に始めると、両方が要約APIを呼び、版が2件保存される
 * （別タブへの変更通知は書き込み後に送るため、生成中であることは伝わらない）。
 * 生成の間 Web Locks API のロックを論文・言語ごとに持ち、取れなかったタブは生成せずに
 * もう一方の生成の終了（ロックの解放）を待つ。ロックはタブを閉じると自動で解放されるため、
 * 生成中のタブを閉じても、待っていたタブや以降の生成が止まったままにならない。
 * Web Locks の無い環境では排他せずに生成する（従来の動作）。
 */

/** ロック名（言語ごとに別の要約を生成するため、論文IDと言語で分ける） */
export const getSummaryLockName = (paperId: string, language: "ja" | "en"): string =>
  `lumina-summary-generation:${paperId}:${language}`;

/** 別のタブの生成の終了を待っているロック名 */
const useWaitingStore = create<{ waitingNames: ReadonlySet<string> }>(() => ({
  waitingNames: new Set(),
}));

const setWaiting = (name: string, waiting: boolean) => {
  useWaitingStore.setState((state) => {
    const waitingNames = new Set(state.waitingNames);
    if (waiting) waitingNames.add(name);
    else waitingNames.delete(name);
    return { waitingNames };
  });
};

/** 論文・言語の要約を別のタブが生成していて、その終了を待っているか */
export const useIsSummaryGeneratingInOtherTab = (paperId: string, language: "ja" | "en"): boolean =>
  useWaitingStore((state) => state.waitingNames.has(getSummaryLockName(paperId, language)));

/**
 * 論文・言語の要約生成を、他のタブと重ならないように実行する
 *
 * @param generate - 要約APIを呼んで保存する処理（ロックを取れたときだけ呼ぶ）
 * @param onGeneratedElsewhere - 別のタブの生成が終わった後に呼ぶ処理（保存された要約の読み直し）
 * @returns generate の結果。別のタブが生成した場合は null
 */
export const runSummaryGenerationExclusively = async <T>(
  paperId: string,
  language: "ja" | "en",
  generate: () => Promise<T>,
  onGeneratedElsewhere?: () => Promise<void>
): Promise<T | null> => {
  const locks = (typeof navigator === "undefined" ? undefined : navigator.locks) as
    | LockManager
    | undefined;
  if (!locks) return generate();

  const name = getSummaryLockName(paperId, language);
  const outcome = await locks.request(name, { ifAvailable: true }, async (lock) =>
    lock ? { result: await generate() } : null
  );
  if (outcome) return outcome.result;

  // 別のタブが生成中: APIは呼ばず、ロックの解放（生成の終了・タブを閉じた）を待つ
  setWaiting(name, true);
  try {
    await locks.request(name, () => undefined);
    // 生成中の表示を解く前に保存された要約を読み込む（要約なしの表示を挟まないため）
    await onGeneratedElsewhere?.().catch((error: unknown) => {
      console.warn("Failed to load the summary generated in another tab", error);
    });
  } finally {
    setWaiting(name, false);
  }
  return null;
};
