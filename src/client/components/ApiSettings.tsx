import { type FC, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Switch } from "@/client/components/ui/switch";
import { useSettingsStore } from "@/client/stores/settingsStore";

/**
 * ApiSettings - OpenAI APIキー設定コンポーネント
 *
 * 機能:
 * - APIキーの入力・保存
 * - 保存済みAPIキーのクリア
 * - パスワードマスク表示
 */
export const ApiSettings: FC = () => {
  const { apiKey, setApiKey, clearApiKey, hasApiKey, autoGenerateSummary, setAutoGenerateSummary } =
    useSettingsStore();
  const [inputValue, setInputValue] = useState(apiKey);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSave = () => {
    setApiKey(inputValue);
    setShowSuccess(true);
    // 3秒後にメッセージを消す
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleClear = () => {
    clearApiKey();
    setInputValue("");
    setShowSuccess(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="api-key">API Key</Label>
        <Input
          id="api-key"
          type="password"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="sk-..."
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave}>保存</Button>
        {hasApiKey() && (
          <Button variant="outline" onClick={handleClear}>
            クリア
          </Button>
        )}
      </div>

      {showSuccess && <p className="text-sm text-green-600">保存しました</p>}

      {/* 自動要約生成スイッチ */}
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-summary">自動要約</Label>
            <p className="text-xs text-muted-foreground">
              論文を開いたときに自動でAI要約を生成します
            </p>
          </div>
          <Switch
            id="auto-summary"
            checked={autoGenerateSummary}
            onCheckedChange={setAutoGenerateSummary}
            disabled={!hasApiKey()}
          />
        </div>
        {!hasApiKey() && (
          <p className="text-xs text-amber-600 mt-2">
            自動要約を有効にするにはAPIキーを設定してください
          </p>
        )}
      </div>
    </div>
  );
};
