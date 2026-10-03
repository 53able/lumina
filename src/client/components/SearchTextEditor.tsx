import { type FC, type FormEvent, useId, useState } from "react";
import { type ExpandedQuery, MAX_EMBEDDING_TEXT_LENGTH } from "../../shared/schemas/index";
import { getApiResumeHint } from "../lib/api";
import {
  appendTerm,
  includesTerm,
  isEditedSearchText,
  removeTerm,
  uniqueTerms,
} from "../lib/searchTextTerms";
import { useSettingsStore } from "../stores/settingsStore";
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

/**
 * SearchTextEditor - Embedding に渡した検索文の確認・編集フォーム
 *
 * 通常は折りたたみ（編集済みの検索では開いた状態で表示）、実際に Embedding に使った検索文
 * （英訳・関連語を含む）を確認・編集して再検索できる。
 * 関連語のチェック状態は検索文に単語境界つきの完全一致で含まれるかから導出し、
 * 外すと検索文からその語句を取り除き、付けると末尾に追加する（再検索に使うのは常に表示中の検索文）。
 * 英訳の内側にある語句は関連語として扱わない。API利用OFF中は再検索できない。
 */
export const SearchTextEditor: FC<SearchTextEditorProps> = ({
  expandedQuery,
  onSubmit,
  isLoading = false,
}) => {
  const { apiEnabled, hasApiKey } = useSettingsStore();
  const [draft, setDraft] = useState(expandedQuery.searchText);
  const textareaId = useId();
  const apiDisabledId = useId();
  const trimmedDraft = draft.trim();
  const canSubmit =
    apiEnabled &&
    !isLoading &&
    trimmedDraft.length > 0 &&
    trimmedDraft.length <= MAX_EMBEDDING_TEXT_LENGTH;
  const { english } = expandedQuery;
  // 編集前の検索文（未編集の検索では表示中の検索文）。「元の検索文に戻す」の戻し先
  const originalSearchText = expandedQuery.originalSearchText ?? expandedQuery.searchText;
  // 同じ関連語が重複して返っても1つにまとめる
  const synonyms = uniqueTerms(expandedQuery.synonyms);

  const handleToggleTerm = (term: string, include: boolean) => {
    setDraft((current) =>
      include ? appendTerm(current, term) : removeTerm(current, term, english)
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmedDraft);
  };

  return (
    <details className="mt-3 text-sm" open={isEditedSearchText(expandedQuery) || undefined}>
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
        {synonyms.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-muted-foreground">
              関連語（検索文にそのまま含まれる語だけチェック済み。外すと検索文から除き、付けると末尾に追加します）
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {synonyms.map((term) => (
                <label key={term} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={includesTerm(draft, term, english)}
                    onChange={(e) => handleToggleTerm(term, e.target.checked)}
                  />
                  {term}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
            aria-describedby={apiEnabled ? undefined : apiDisabledId}
          >
            この検索文で再検索
          </Button>
          {draft !== originalSearchText ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraft(originalSearchText)}
            >
              元の検索文に戻す
            </Button>
          ) : null}
        </div>
        {apiEnabled ? null : (
          <p id={apiDisabledId} className="text-xs text-muted-foreground">
            API利用OFFのため再検索を停止中。{getApiResumeHint(hasApiKey())}
          </p>
        )}
      </form>
    </details>
  );
};
