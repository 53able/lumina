import { type FC, useState } from "react";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Switch } from "./ui/switch.js";
import { useSettingsStore } from "../stores/settingsStore.js";

/**
 * ApiSettings - OpenAI APIキー設定コンポーネント
 *
 * 機能:
 * - APIキーの入力・保存（暗号化）
 * - 保存済みAPIキーのクリア
 * - パスワードマスク表示
 *
 * @remarks
 * API key は暗号化されて localStorage に保存される。
 * 入力フィールドは常に空（マスク済み）を表示し、
 * 保存時に新しい値で上書きする。
 */
export const ApiSettings: FC = () => {
  const { setApiKeyAsync, clearApiKey, hasApiKey, autoGenerateSummary, setAutoGenerateSummary } =
    useSettingsStore();
  const [inputValue, setInputValue] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!inputValue.trim()) return;

    setIsSaving(true);
    try {
      await setApiKeyAsync(inputValue);
      setShowSuccess(true);
      setInputValue(""); // 入力フィールドをクリア（セキュリティのため）
      // 3秒後にメッセージを消す
      setTimeout(() => setShowSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
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
          placeholder={hasApiKey() ? "••••••••（設定済み - 新しいキーで上書き）" : "sk-..."}
        />
        {hasApiKey() && (
          <p className="text-xs text-muted-foreground">API key は暗号化されて保存されています</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isSaving || !inputValue.trim()}>
          {isSaving ? "保存中..." : "保存"}
        </Button>
        {hasApiKey() && (
          <Button variant="outline" onClick={handleClear} disabled={isSaving}>
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
