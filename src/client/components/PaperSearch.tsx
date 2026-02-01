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
  /** 初期クエリ */
  defaultQuery?: string;
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
}) => {
  const [query, setQuery] = useState(defaultQuery);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return;
    }
    onSearch(trimmedQuery);
    if (clearAfterSearch) {
      setQuery("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2 sm:gap-3 relative">
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
        className="group px-4 py-2 h-9 sm:h-10 lg:h-12 sm:px-6 sm:py-3 font-bold text-sm sm:text-base shadow-lg hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:scale-110 hover:rotate-1 active:scale-95 active:rotate-[-1deg] glow-effect shrink-0"
      >
        <Search className="mr-1.5 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-125" />
        検索
      </Button>
    </form>
  );
};
