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

/** 別のタブの生成の終了を待つ上限（超えたら待つのをやめ、失敗として伝える） */
export const OTHER_TAB_WAIT_TIMEOUT_MS = 120_000;

/** 別のタブの生成を待ち切れなかった（生成中のまま応答がない） */
export class OtherTabGenerationTimeoutError extends Error {
  constructor() {
    super("別のタブの要約生成が終わらないため、待つのをやめました");
    this.name = "OtherTabGenerationTimeoutError";
  }
}

/**
 * 別のタブに任せた生成の結果
 * - produced: 別のタブが要約を保存した（このタブはそれを表示する）
 * - notProduced: 別のタブの生成は要約を残さずに終わった（失敗・タブを閉じた）
 */
export type OtherTabOutcome = "produced" | "notProduced";

/** 排他した生成の結果 */
export type ExclusiveGenerationResult<T> =
  | { kind: "generated"; result: T }
  | { kind: "elsewhere"; produced: boolean };

interface GenerationLockState {
  /** 別のタブの生成の終了を待っているロック名 */
  waitingNames: ReadonlySet<string>;
  /** 直近の生成を別のタブに任せた場合の結果（ロック名ごと。次の生成の開始で消す） */
  outcomes: ReadonlyMap<string, OtherTabOutcome>;
}

const useGenerationLockStore = create<GenerationLockState>(() => ({
  waitingNames: new Set(),
  outcomes: new Map(),
}));

const setWaiting = (name: string, waiting: boolean) => {
  useGenerationLockStore.setState((state) => {
    const waitingNames = new Set(state.waitingNames);
    if (waiting) waitingNames.add(name);
    else waitingNames.delete(name);
    return { waitingNames };
  });
};

const setOutcome = (name: string, outcome: OtherTabOutcome | null) => {
  useGenerationLockStore.setState((state) => {
    const outcomes = new Map(state.outcomes);
    if (outcome) outcomes.set(name, outcome);
    else outcomes.delete(name);
    return { outcomes };
  });
};

/** 論文・言語の要約を別のタブが生成していて、その終了を待っているか */
export const useIsSummaryGeneratingInOtherTab = (paperId: string, language: "ja" | "en"): boolean =>
  useGenerationLockStore((state) => state.waitingNames.has(getSummaryLockName(paperId, language)));

/** 論文・言語の直近の生成を別のタブに任せた場合の結果（任せていなければ null） */
export const useOtherTabGenerationOutcome = (
  paperId: string,
  language: "ja" | "en"
): OtherTabOutcome | null =>
  useGenerationLockStore(
    (state) => state.outcomes.get(getSummaryLockName(paperId, language)) ?? null
  );

interface ExclusiveGenerationOptions<T> {
  /** 要約APIを呼んで保存する処理（ロックを取れたときだけ呼ぶ） */
  generate: () => Promise<T>;
  /** IndexedDB 上の論文・言語の版を読む（別のタブが保存したかの判定に使う） */
  readVersions: () => Promise<unknown[]>;
  /** 別のタブが保存した要約を Store へ読み込む */
  reload: () => Promise<void>;
  /**
   * 要約が無いとみて始めた生成か（自動生成・要約が無いときの「要約 + 説明文」）
   * true なら、ロックを取れた時点で既に版があれば生成しない（直前に別のタブが保存した場合）。
   * 再生成など新しい版を求める生成は false
   */
  onlyIfMissing: boolean;
}

/** 読み直しの失敗は警告に留める（版は保存済みで、別タブの変更通知でも反映される） */
const reloadQuietly = async (reload: () => Promise<void>) => {
  await reload().catch((error: unknown) => {
    console.warn("Failed to load the summary generated in another tab", error);
  });
};

/**
 * 論文・言語の要約生成を、他のタブと重ならないように実行する
 *
 * @returns 生成した場合は generate の結果。別のタブに任せた場合は、要約が保存されたか
 */
export const runSummaryGenerationExclusively = async <T>(
  paperId: string,
  language: "ja" | "en",
  { generate, readVersions, reload, onlyIfMissing }: ExclusiveGenerationOptions<T>
): Promise<ExclusiveGenerationResult<T>> => {
  const locks = (typeof navigator === "undefined" ? undefined : navigator.locks) as
    | LockManager
    | undefined;
  if (!locks) return { kind: "generated", result: await generate() };

  const name = getSummaryLockName(paperId, language);
  setOutcome(name, null);

  let versionsBeforeWait = "";
  const acquired = await locks.request(
    name,
    { ifAvailable: true },
    async (lock): Promise<ExclusiveGenerationResult<T> | null> => {
      if (!lock) {
        // 待つ前の版を控える（待ち終えた後に、別のタブが保存したかを比べるため）
        versionsBeforeWait = JSON.stringify(await readVersions());
        return null;
      }
      // 別のタブがロックを解放した直後で、変更通知がまだ届いていない場合は、既にある版を表示する
      if (onlyIfMissing && (await readVersions()).length > 0) {
        await reloadQuietly(reload);
        return { kind: "elsewhere", produced: true };
      }
      return { kind: "generated", result: await generate() };
    }
  );
  if (acquired) {
    if (acquired.kind === "elsewhere") setOutcome(name, "produced");
    return acquired;
  }

  // 別のタブが生成中: APIは呼ばず、ロックの解放（生成の終了・タブを閉じた）を待つ
  setWaiting(name, true);
  try {
    try {
      await locks.request(
        name,
        { signal: AbortSignal.timeout(OTHER_TAB_WAIT_TIMEOUT_MS) },
        () => undefined
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new OtherTabGenerationTimeoutError();
      }
      throw error;
    }
    const versions = await readVersions();
    // 要約が無いとみて待った場合は版があれば、それ以外は版が変わっていれば、別のタブが保存したとみなす
    const produced = onlyIfMissing
      ? versions.length > 0
      : JSON.stringify(versions) !== versionsBeforeWait;
    // 生成中の表示を解く前に保存された要約を読み込む（要約なしの表示を挟まないため）
    if (produced) await reloadQuietly(reload);
    setOutcome(name, produced ? "produced" : "notProduced");
    return { kind: "elsewhere", produced };
  } finally {
    setWaiting(name, false);
  }
};
