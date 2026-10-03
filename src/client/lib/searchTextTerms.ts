/**
 * Embedding に渡す検索文と関連語の対応づけ（含まれるか・除外・追加）。
 *
 * 語句は前後が文字・数字でない位置（Unicode の単語境界）にある完全一致だけを扱う。
 * "RL" は "world" に、"neural network" は "neural networks" に一致しない。
 * 英訳（protectedPhrase）の出現箇所の内側にある一致は、関連語として数えず除外もしない。
 */
import type { ExpandedQuery } from "../../shared/schemas/index";

/** 正規表現の特殊文字をエスケープする */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Range = readonly [start: number, end: number];

/** text 中で phrase が単語境界つきで現れる範囲（大文字小文字は区別しない） */
const findPhraseRanges = (text: string, phrase: string): Range[] => {
  if (phrase.trim() === "") return [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, "giu");
  return [...text.matchAll(pattern)].map((m) => [m.index, m.index + m[0].length] as const);
};

/** 英訳の出現箇所の内側にない term の出現範囲 */
const findTermRanges = (text: string, term: string, protectedPhrase?: string): Range[] => {
  const protectedRanges =
    protectedPhrase !== undefined && protectedPhrase.toLowerCase() !== term.toLowerCase()
      ? findPhraseRanges(text, protectedPhrase)
      : [];
  return findPhraseRanges(text, term).filter(
    ([start, end]) => !protectedRanges.some(([ps, pe]) => start >= ps && end <= pe)
  );
};

/** 改行以外の空白か */
const isInlineSpace = (char: string | undefined): boolean =>
  char !== undefined && char !== "\n" && char !== "\r" && /\s/.test(char);

/** 検索文に関連語が含まれるか */
export const includesTerm = (text: string, term: string, protectedPhrase?: string): boolean =>
  findTermRanges(text, term, protectedPhrase).length > 0;

/**
 * 検索文から関連語の完全一致をすべて取り除く。
 * 取り除いた箇所の片側の空白（改行以外）だけを詰め、それ以外の空白・改行は保つ。
 */
export const removeTerm = (text: string, term: string, protectedPhrase?: string): string => {
  let result = text;
  for (const [rangeStart, rangeEnd] of findTermRanges(text, term, protectedPhrase).reverse()) {
    let start = rangeStart;
    let end = rangeEnd;
    if (isInlineSpace(result[start - 1])) {
      while (isInlineSpace(result[start - 1])) start -= 1;
    } else {
      while (isInlineSpace(result[end])) end += 1;
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trim();
};

/** 検索文の末尾に関連語を追加する */
export const appendTerm = (text: string, term: string): string => {
  const base = text.trimEnd();
  return base === "" ? term : `${base} ${term}`;
};

/** 利用者が検索文を編集して検索したか（元の検索文と異なるか） */
export const isEditedSearchText = (query: ExpandedQuery): boolean =>
  query.originalSearchText !== undefined && query.originalSearchText !== query.searchText;

/** 元の検索文に含まれていたが、編集後の検索文から除かれた関連語か */
export const isExcludedTerm = (query: ExpandedQuery, term: string): boolean =>
  query.originalSearchText !== undefined &&
  includesTerm(query.originalSearchText, term, query.english) &&
  !includesTerm(query.searchText, term, query.english);
