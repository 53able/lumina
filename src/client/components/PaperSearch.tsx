import { Search } from "lucide-react";
import { type FC, type FormEvent, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * PaperSearch コンポーネントのProps
 */
interface PaperSearchProps {
  /** 検索実行時のコールバック */
  onSearch: (query: string) => void;
  /** ローディング状態 */
  isLoading?: boolean;
  /** 検索後に入力をクリアするか */
  clearAfterSearch?: boolean;
  /** 初期クエリ（非制御モード時） */
  defaultQuery?: string;
  /** 入力値（制御モード時。value と onChange の両方で制御） */
  value?: string;
  /** 入力変更時のコールバック（制御モード時） */
  onChange?: (value: string) => void;
}

/**
 * PaperSearch - 論文検索ボックスコンポーネント
 *
 * Design Docsに基づく機能:
 * - 検索ボックス（テキスト入力）
 * - 検索ボタン
 * - Enterキーでの検索実行
 */
export const PaperSearch: FC<PaperSearchProps> = ({
  onSearch,
  isLoading = false,
  clearAfterSearch = false,
  defaultQuery = "",
  value: controlledValue,
  onChange: onControlledChange,
}) => {
  const [internalQuery, setInternalQuery] = useState(defaultQuery);
  const isControlled = controlledValue !== undefined && onControlledChange !== undefined;
  const query = isControlled ? controlledValue : internalQuery;
  const setQuery = isControlled ? onControlledChange : setInternalQuery;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return;
    }
    onSearch(trimmedQuery);
    if (clearAfterSearch && !isControlled) {
      setInternalQuery("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center w-full gap-2 sm:gap-3 relative">
      <div className="flex-1 relative glow-effect min-w-0">
        <Input
          type="search"
          role="searchbox"
          placeholder="論文を検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isLoading}
          className="w-full h-9 sm:h-10 lg:h-11"
        />
      </div>
      <Button
        type="submit"
        disabled={isLoading}
        size="lg"
        aria-label="検索"
        className="group size-9 shrink-0 sm:size-auto sm:px-6 sm:py-3 sm:h-10 sm:min-h-[40px] sm:min-w-[40px] lg:h-11 font-bold text-sm sm:text-base shadow-lg hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:scale-110 hover:rotate-1 active:scale-95 active:-rotate-1 glow-effect"
      >
        <Search className="h-4 w-4 sm:mr-2 sm:h-5 sm:w-5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-125" />
        <span className="hidden sm:inline">検索</span>
      </Button>
    </form>
  );
};
