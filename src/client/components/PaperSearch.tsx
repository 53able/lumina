import { Search } from "lucide-react";
import { type FC, type FormEvent, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";

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
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <Input
        type="search"
        role="searchbox"
        placeholder="論文を検索..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={isLoading}
        className="flex-1"
      />
      <Button type="submit" disabled={isLoading}>
        <Search className="mr-2 h-4 w-4" />
        検索
      </Button>
    </form>
  );
};
