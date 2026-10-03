/**
 * Abstract の文分割と、要約のキーポイントに対応する文（根拠）の検証
 *
 * サーバー（要約生成時の文番号の付与と検証）とクライアント（該当文の表示）で同じ分割を使うため、
 * 入力が同じなら常に同じ結果を返す決定的な関数にしている。
 */

/** 文末とみなさない略語（直後の空白で文を区切らない） */
const NON_TERMINAL_ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "et al.",
  "etc.",
  "vs.",
  "cf.",
  "fig.",
  "figs.",
  "eq.",
  "eqs.",
  "sec.",
  "no.",
  "approx.",
  "resp.",
];

/** 空白なしで文を終える全角の終止符 */
const FULL_WIDTH_TERMINATORS = new Set(["。", "！", "？"]);
/** 直後に空白があれば文を終える半角の終止符 */
const HALF_WIDTH_TERMINATORS = new Set([".", "!", "?"]);

/**
 * Abstract を文に分割する（前後の空白を除き、空の文は返さない）
 *
 * - 「.」「!」「?」は直後が空白で、その後が小文字で始まらない場合に文末とする
 *   （小数点「3.5」や略語「e.g.」「et al.」では区切らない）
 * - 「。」「！」「？」は直後で区切る
 */
export const splitAbstractSentences = (abstract: string): string[] => {
  const sentences: string[] = [];
  let start = 0;
  const push = (end: number) => {
    const sentence = abstract.slice(start, end).replace(/\s+/g, " ").trim();
    if (sentence) sentences.push(sentence);
    start = end;
  };

  for (let i = 0; i < abstract.length; i++) {
    const char = abstract[i];
    if (FULL_WIDTH_TERMINATORS.has(char)) {
      push(i + 1);
      continue;
    }
    if (!HALF_WIDTH_TERMINATORS.has(char)) continue;
    const next = abstract[i + 1];
    if (next === undefined || !/\s/.test(next)) continue;
    // 空白の後の最初の文字が小文字なら文の途中とみなす
    const following = abstract.slice(i + 1).match(/^\s+(\S)/)?.[1];
    if (following !== undefined && /\p{Ll}/u.test(following)) continue;
    if (char === ".") {
      const head = abstract.slice(start, i + 1).toLowerCase();
      if (NON_TERMINAL_ABBREVIATIONS.some((abbr) => head.endsWith(` ${abbr}`) || head === abbr)) {
        continue;
      }
    }
    push(i + 1);
  }
  push(abstract.length);
  return sentences;
};

/**
 * キーポイントの根拠となる Abstract の文
 * text は生成時の Abstract の文そのもので、表示時に Abstract が変わっていないかの照合に使う
 */
export interface EvidenceSentence {
  /** splitAbstractSentences の文番号（0始まり） */
  index: number;
  /** 文の本文 */
  text: string;
}

/**
 * AIが返した文番号を検証し、キーポイントごとの根拠（Abstract に実在する文だけ）を作る
 *
 * - 範囲外・整数でない・重複の番号は捨てる（Abstract にない文を根拠として返さない）
 * - 番号が残らない・AIが返さなかったキーポイントは空配列（対応箇所未確認）にする
 * - 戻り値はキーポイントと同じ長さ・順序
 *
 * 文番号の一致は「Abstract のこの文に対応づけた」ことしか示さず、キーポイントの正しさは保証しない。
 */
export const resolveKeyPointEvidence = (
  sentences: readonly string[],
  keyPointCount: number,
  rawIndices: unknown
): EvidenceSentence[][] =>
  Array.from({ length: keyPointCount }, (_, i) => {
    const candidates = Array.isArray(rawIndices) ? rawIndices[i] : undefined;
    if (!Array.isArray(candidates)) return [];
    const seen = new Set<number>();
    const evidence: EvidenceSentence[] = [];
    for (const index of candidates) {
      if (!Number.isInteger(index) || index < 0 || index >= sentences.length || seen.has(index)) {
        continue;
      }
      seen.add(index);
      evidence.push({ index, text: sentences[index] });
    }
    return evidence;
  });

/**
 * 保存済みの根拠のうち、表示中の Abstract の同じ番号に同じ文があるものの番号を返す
 * Abstract が更新されて文が変わった場合や、根拠のない古い要約は空配列（対応箇所未確認）になる
 */
export const findConfirmedEvidenceIndices = (
  sentences: readonly string[],
  evidence: readonly EvidenceSentence[] | undefined
): number[] => (evidence ?? []).filter((e) => sentences[e.index] === e.text).map((e) => e.index);
