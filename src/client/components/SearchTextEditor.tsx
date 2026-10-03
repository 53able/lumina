import { type FC, type FormEvent, useId, useState } from "react";
import { type ExpandedQuery, MAX_EMBEDDING_TEXT_LENGTH } from "../../shared/schemas/index";
import { Button } from "./ui/button";

/**
 * SearchTextEditor のProps
 */
interface SearchTextEditorProps {
  /** 表示中の検索の拡張クエリ（searchText が Embedding に渡した検索文） */
  expandedQuery: ExpandedQuery;
  /** 編集した検索文で再検索する */
  onSubmit: (searchText: string) => void;
  /** 検索中かどうか（再検索ボタンを無効にする） */
  isLoading?: boolean;
}

/** 正規表現の特殊文字をエスケープする */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 連続する空白を1つにまとめ、前後の空白を除く */
const normalizeSpaces = (value: string): string => value.replace(/\s+/g, " ").trim();

/** 検索文に関連語が含まれるか（大文字小文字は区別しない） */
const includesTerm = (text: string, term: string): boolean =>
  text.toLowerCase().includes(term.toLowerCase());

/** 検索文から関連語をすべて取り除く（大文字小文字は区別しない） */
const removeTerm = (text: string, term: string): string =>
  normalizeSpaces(text.replace(new RegExp(escapeRegExp(term), "gi"), " "));

/**
 * SearchTextEditor - Embedding に渡した検索文の確認・編集フォーム
 *
 * 通常は折りたたみ、開くと実際に Embedding に使った検索文（英訳・関連語を含む）を表示する。
 * 検索文の編集や関連語の除外・追加をして再検索できる。関連語のチェック状態は検索文の内容から導出し、
 * 外すと検索文からその語句を取り除き、付けると末尾に追加する（再検索に使うのは常に表示中の検索文）。
 */
export const SearchTextEditor: FC<SearchTextEditorProps> = ({
  expandedQuery,
  onSubmit,
  isLoading = false,
}) => {
  const [draft, setDraft] = useState(expandedQuery.searchText);
  const textareaId = useId();
  const trimmedDraft = draft.trim();
  const canSubmit =
    !isLoading && trimmedDraft.length > 0 && trimmedDraft.length <= MAX_EMBEDDING_TEXT_LENGTH;

  const handleToggleTerm = (term: string, include: boolean) => {
    setDraft((current) =>
      include ? normalizeSpaces(`${current} ${term}`) : removeTerm(current, term)
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmedDraft);
  };

  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-bold text-primary-light">
        Embeddingに使った検索文を確認・編集
      </summary>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <label htmlFor={textareaId} className="text-xs text-muted-foreground">
          検索文（編集して再検索できます。元の入力は変わりません）
        </label>
        <textarea
          id={textareaId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_EMBEDDING_TEXT_LENGTH}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {expandedQuery.synonyms.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-muted-foreground">
              関連語（外すと検索文から除き、付けると末尾に追加します）
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {expandedQuery.synonyms.map((term) => (
                <label key={term} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={includesTerm(draft, term)}
                    onChange={(e) => handleToggleTerm(term, e.target.checked)}
                  />
                  {term}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            この検索文で再検索
          </Button>
        </div>
      </form>
    </details>
  );
};
