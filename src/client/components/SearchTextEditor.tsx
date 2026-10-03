import { type FC, type FormEvent, useId, useState } from "react";
import { type ExpandedQuery, MAX_EMBEDDING_TEXT_LENGTH } from "../../shared/schemas/index";
import { getApiResumeHint } from "../lib/api";
import {
  buildSearchText,
  isEditedSearchText,
  parseSelectedTerms,
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
 * 検索文の作り方。
 * - selection が null かつ freeText が null: AIが作った検索文をそのまま使う（関連語はすべてチェック済み）
 * - selection が配列: 英訳 + チェックした関連語から作る（buildSearchText）
 * - freeText が文字列: 利用者が直接編集した文を使う（関連語の選択は無効）
 */
interface EditorState {
  selection: string[] | null;
  freeText: string | null;
}

/** 表示中の検索文から編集状態を復元する（再検索後・履歴から開いた場合も同じ状態に戻す） */
const initialState = (query: ExpandedQuery, aiText: string, synonyms: string[]): EditorState => {
  if (query.searchText === aiText) return { selection: null, freeText: null };
  const selection = parseSelectedTerms(query.searchText, query.english, synonyms);
  return selection !== null
    ? { selection, freeText: null }
    : { selection: null, freeText: query.searchText };
};

/**
 * SearchTextEditor - AIが検索に使った言葉（英訳・関連語・検索文）の確認と調整
 *
 * 利用者の入力・AIの英訳・AIが作った検索文を並べ、関連語は「検索に含める選択」として扱う。
 * 初期状態は AIが作った検索文（関連語を言い換えて含むことがある）をそのまま使い、
 * 関連語のチェックを変えた時点で「英訳 + チェックした関連語」から検索文を作り直す。
 * チェック状態は検索文の文字列からは推測せず、外した語を暗黙に再追加しない。
 * 検索文の直接編集は折りたたみの中に置き、選択から作る文と異なる文にすると
 * 「自由編集中（関連語の選択は無効）」と示す。再検索で送る文は常に「検索に使う文」に表示する。
 * API利用OFF中は再検索できない。
 */
export const SearchTextEditor: FC<SearchTextEditorProps> = ({
  expandedQuery,
  onSubmit,
  isLoading = false,
}) => {
  const { apiEnabled, hasApiKey } = useSettingsStore();
  const { original, english } = expandedQuery;
  // 同じ関連語が重複して返っても1つにまとめる
  const synonyms = uniqueTerms(expandedQuery.synonyms);
  // クエリ拡張（AI）が作った検索文。編集して再検索した後も編集前の文を指す
  const aiText = expandedQuery.originalSearchText ?? expandedQuery.searchText;
  const [{ selection, freeText }, setState] = useState<EditorState>(() =>
    initialState(expandedQuery, aiText, synonyms)
  );
  const textareaId = useId();
  const statusId = useId();
  const editHintId = useId();
  const finalTextId = useId();
  const apiDisabledId = useId();

  const structuredText = selection === null ? aiText : buildSearchText(english, selection);
  const isFreeEditing = freeText !== null;
  const finalText = freeText ?? structuredText;
  const trimmedFinalText = finalText.trim();
  const canSubmit =
    apiEnabled &&
    !isLoading &&
    trimmedFinalText.length > 0 &&
    trimmedFinalText.length <= MAX_EMBEDDING_TEXT_LENGTH;

  const handleToggleTerm = (term: string, include: boolean) => {
    const current = selection ?? synonyms;
    const next = include ? [...current, term] : current.filter((t) => t !== term);
    setState({ selection: synonyms.filter((t) => next.includes(t)), freeText: null });
  };

  const handleFreeEdit = (value: string) => {
    // 選択から作る文と同じに戻した場合は自由編集とみなさない
    setState({ selection, freeText: value === structuredText ? null : value });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmedFinalText);
  };

  // 自由編集で開いた（直前の選択がない）場合は、選択の起点が AIが作った検索文になる
  const resetButtonLabel = selection === null ? "AIが作った検索文に戻す" : "関連語の選択に戻す";
  const statusMessage = isFreeEditing
    ? `自由編集中（関連語の選択は無効）。直接編集した文で検索します。関連語のチェックを使うには「${resetButtonLabel}」を押してください。`
    : selection === null
      ? "AIが作った検索文をそのまま使います（AIは関連語を言い換えて含めることがあります）。関連語のチェックを変えると、英訳とチェックした関連語から検索文を作り直します。"
      : "英訳とチェックした関連語から作った検索文を使います。チェックを外した語は検索に含めません。";

  return (
    <details className="mt-3 text-sm" open={isEditedSearchText(expandedQuery) || undefined}>
      <summary className="cursor-pointer text-xs font-bold text-primary-light">
        AIが検索に使った言葉を確認・調整
      </summary>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">あなたの入力</dt>
          <dd>{original}</dd>
          <dt className="text-muted-foreground">AIの英訳</dt>
          <dd>{english}</dd>
          <dt className="text-muted-foreground">AIが作った検索文</dt>
          <dd className="break-words">{aiText}</dd>
        </dl>
        {synonyms.length > 0 ? (
          <fieldset disabled={isFreeEditing} className="flex flex-col gap-1 disabled:opacity-60">
            <legend className="text-xs text-muted-foreground">
              {isFreeEditing
                ? "AIが追加した関連語（自由編集中のため選択は無効）"
                : selection === null
                  ? "AIが追加した関連語（チェックを変えると、英訳と選んだ語から検索文を作り直します）"
                  : "AIが追加した関連語（チェックした語を検索に含めます）"}
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {synonyms.map((term) => (
                <label key={term} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={selection === null || selection.includes(term)}
                    onChange={(e) => handleToggleTerm(term, e.target.checked)}
                  />
                  {term}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <output id={statusId} className="block text-xs text-muted-foreground">
          {statusMessage}
        </output>
        <div className="flex flex-col gap-1">
          <span id={finalTextId} className="text-xs font-bold">
            検索に使う文{isFreeEditing ? "（手動で編集）" : null}
          </span>
          <output
            aria-labelledby={finalTextId}
            aria-live="off"
            className="block rounded-md border border-input bg-background/50 px-3 py-2 text-sm break-words"
          >
            {finalText}
          </output>
        </div>
        <details open={isFreeEditing || undefined}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            検索文を直接編集する
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            <label htmlFor={textareaId} className="text-xs text-muted-foreground">
              検索文を直接編集
            </label>
            <p id={editHintId} className="text-xs text-muted-foreground">
              編集すると関連語の選択は無効になります。元の入力は変わりません。
            </p>
            <textarea
              id={textareaId}
              value={finalText}
              onChange={(e) => handleFreeEdit(e.target.value)}
              aria-describedby={`${editHintId} ${statusId}`}
              maxLength={MAX_EMBEDDING_TEXT_LENGTH}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
            aria-describedby={apiEnabled ? undefined : apiDisabledId}
          >
            この検索文で再検索
          </Button>
          {isFreeEditing && selection !== null ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setState({ selection, freeText: null })}
            >
              関連語の選択に戻す
            </Button>
          ) : null}
          {finalText !== aiText ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setState({ selection: null, freeText: null })}
            >
              AIが作った検索文に戻す
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
