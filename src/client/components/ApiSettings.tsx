import { type FC, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

/**
 * ApiSettings - OpenAI APIキー設定コンポーネント
 *
 * 機能:
 * - APIキーの入力・保存（暗号化）
 * - 保存済みAPIキーのクリア
 * - パスワードマスク表示
 * - 利用可能のON/OFF（APIキー設定済み時のみ操作可能）
 * - 自動要約のON/OFF（利用可能がONのときのみ操作可能）
 * - 利用可能OFF時に停止する処理と再開方法の説明
 *
 * @remarks
 * API key は暗号化されて localStorage に保存される。
 * 入力フィールドは常に空（マスク済み）を表示し、
 * 保存時に新しい値で上書きする。
 */
export const ApiSettings: FC = () => {
  const {
    setApiKeyAsync,
    clearApiKey,
    hasApiKey,
    apiEnabled,
    setApiEnabled,
    canUseApi,
    autoGenerateSummary,
    setAutoGenerateSummary,
  } = useSettingsStore();
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

      {/* 利用可能スイッチ */}
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="api-enabled">利用可能</Label>
            <p className="text-xs text-muted-foreground">
              {hasApiKey()
                ? "APIキーを使って検索・同期・要約を行う"
                : "APIキーを設定すると利用可能のON/OFFができます"}
            </p>
          </div>
          <Switch
            id="api-enabled"
            checked={apiEnabled}
            onCheckedChange={setApiEnabled}
            disabled={!hasApiKey()}
          />
        </div>
        {!apiEnabled && (
          <div className="mt-2 text-xs text-amber-600">
            <p className="font-medium">API利用がOFFのため、次の処理を停止しています</p>
            <ul className="mt-1 list-disc pl-4">
              <li>AI検索（クエリ拡張・検索用Embedding）</li>
              <li>要約・説明文の生成（自動・手動とも）</li>
              <li>Embedding補完と、同期時のEmbedding生成</li>
            </ul>
            <p className="mt-1">
              arXivからの論文同期と、保存済みの論文・要約・検索履歴の閲覧は引き続き利用できます。「利用可能」をONにすると再開します。
            </p>
          </div>
        )}
      </div>

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
            disabled={!canUseApi()}
          />
        </div>
        {!canUseApi() && (
          <p className="text-xs text-amber-600 mt-2">
            自動要約を有効にするにはAPIキーを設定し、利用可能をONにしてください
          </p>
        )}
      </div>
    </div>
  );
};
