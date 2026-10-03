/**
 * Embedding に渡す検索文と、関連語の選択との対応づけ。
 *
 * 関連語の選択から作る検索文は「英訳 + 選んだ関連語（synonyms の順）」を空白1つでつないだ形だけとし、
 * 検索文からチェック状態を推測するのは、検索文がこの形そのものである場合に限る。
 * 語句の部分一致・語順の違い・言い換えから「含まれる／除いた」を推測しない
 * （完全一致しない語を削除済みのように見せないため）。
 */
import type { ExpandedQuery } from "../../shared/schemas/index";

/** 関連語の重複を除く（大文字小文字は区別せず、最初の表記を残す） */
export const uniqueTerms = (terms: readonly string[]): string[] => {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * 英訳と選んだ関連語から検索文を作る（前後の空白を除き、空の語は飛ばして空白1つでつなぐ）。
 * 選択を外した語は検索文に入らない。
 */
export const buildSearchText = (english: string, selectedTerms: readonly string[]): string =>
  [english, ...selectedTerms]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");

/**
 * 検索文が buildSearchText(english, 選択) の形そのものなら、その選択（synonyms の順）を返す。
 * 形が一致しない（自由編集・AIが作った文・語順の入れ替えなど）なら null。
 * 関連語どうしが前方一致する場合（graph と graph neural network）も取り違えないよう候補を順に試す。
 */
export const parseSelectedTerms = (
  text: string,
  english: string,
  synonyms: readonly string[]
): string[] | null => {
  const candidates = synonyms.filter((term) => term.trim() !== "");
  const match = (from: number, chosen: string[]): string[] | null => {
    if (buildSearchText(english, chosen) === text) return chosen;
    for (let i = from; i < candidates.length; i += 1) {
      const next = [...chosen, candidates[i] as string];
      const prefix = buildSearchText(english, next);
      if (text === prefix || text.startsWith(`${prefix} `)) {
        const found = match(i + 1, next);
        if (found) return found;
      }
    }
    return null;
  };
  return match(0, []);
};

/** 利用者が検索文を編集して検索したか（元の検索文と異なるか） */
export const isEditedSearchText = (query: ExpandedQuery): boolean =>
  query.originalSearchText !== undefined && query.originalSearchText !== query.searchText;

/**
 * 関連語の選択で作った検索文から、選択を外した関連語か。
 * 検索文が選択の形（buildSearchText）でない自由編集では、語の一致から削除を推測しない（常に false）。
 */
export const isExcludedTerm = (query: ExpandedQuery, term: string): boolean => {
  if (!isEditedSearchText(query)) return false;
  const selected = parseSelectedTerms(query.searchText, query.english, uniqueTerms(query.synonyms));
  return selected !== null && !selected.includes(term);
};
