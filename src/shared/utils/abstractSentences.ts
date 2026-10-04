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

/** 略語の最大の長さ（略語判定で見る直前の文字数を一定に保ち、分割を入力長に対して線形にする） */
const MAX_ABBREVIATION_LENGTH = Math.max(...NON_TERMINAL_ABBREVIATIONS.map((abbr) => abbr.length));

/** 略語の直前に来てよい文字（空白と開き括弧。"(Fig. 2)" や "[e.g. X]" を略語とみなす） */
const ABBREVIATION_PRECEDING = /[\s([{]/;

/** 空白なしで文を終える全角の終止符 */
const FULL_WIDTH_TERMINATORS = new Set(["。", "！", "？"]);
/** 直後に空白があれば文を終える半角の終止符 */
const HALF_WIDTH_TERMINATORS = new Set([".", "!", "?"]);

const WHITESPACE = /\s/;
const WHITESPACE_RUN = /\s+/g;
const LOWERCASE_LETTER = /\p{Ll}/u;

const isWhitespace = (char: string | undefined) => char !== undefined && WHITESPACE.test(char);

/**
 * 位置 end（「.」の直後）の直前が略語で終わるか
 * 文の先頭（start）より前は見ない。見る文字数は略語の最大長＋1文字で一定
 */
const endsWithAbbreviation = (text: string, start: number, end: number): boolean => {
  const tail = text.slice(Math.max(start, end - MAX_ABBREVIATION_LENGTH - 1), end).toLowerCase();
  return NON_TERMINAL_ABBREVIATIONS.some((abbr) => {
    if (!tail.endsWith(abbr)) return false;
    const abbrStart = end - abbr.length;
    return abbrStart === start || ABBREVIATION_PRECEDING.test(text[abbrStart - 1]);
  });
};

/**
 * Abstract を文に分割する（前後の空白を除き、空の文は返さない）
 *
 * - 「.」「!」「?」は直後が空白で、その後が小文字で始まらない場合に文末とする
 *   （小数点「3.5」や略語「e.g.」「et al.」「(Fig. 2)」では区切らない）
 * - 「。」「！」「？」は直後で区切る
 * - 入力長に対して線形時間で動く（各位置は定数回しか見ない）
 */
export const splitAbstractSentences = (abstract: string): string[] => {
  const sentences: string[] = [];
  let start = 0;
  const push = (end: number) => {
    const sentence = abstract.slice(start, end).replace(WHITESPACE_RUN, " ").trim();
    if (sentence) sentences.push(sentence);
    start = end;
  };

  for (let i = 0; i < abstract.length; i++) {
    const char = abstract[i];
    if (FULL_WIDTH_TERMINATORS.has(char)) {
      push(i + 1);
      continue;
    }
    if (!HALF_WIDTH_TERMINATORS.has(char) || !isWhitespace(abstract[i + 1])) continue;
    // 空白の後の最初の文字が小文字なら文の途中とみなす（空白の連続は次の終止符まで1回しか走査しない）
    let j = i + 1;
    while (isWhitespace(abstract[j])) j++;
    const following = abstract[j];
    if (following !== undefined && LOWERCASE_LETTER.test(following)) continue;
    if (char === "." && endsWithAbbreviation(abstract, start, i + 1)) continue;
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
