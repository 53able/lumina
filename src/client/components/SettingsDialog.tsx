import type { FC } from "react";
import { ApiSettings } from "./ApiSettings";
import { CategorySettings } from "./CategorySettings";
import { SyncSettings } from "./SyncSettings";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/**
 * SettingsDialog Props
 */
interface SettingsDialogProps {
  /** ダイアログの開閉状態 */
  open: boolean;
  /** ダイアログの開閉状態が変化したときのコールバック */
  onOpenChange: (open: boolean) => void;
}

/**
 * SettingsDialog - 設定ダイアログコンポーネント
 *
 * Design Docsに基づく機能:
 * - タブで設定項目を切り替え
 * - API設定、カテゴリ設定、同期設定
 */
export const SettingsDialog: FC<SettingsDialogProps> = ({ open, onOpenChange }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>APIキーやカテゴリ、同期設定を変更できます</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="api" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="api">API</TabsTrigger>
            <TabsTrigger value="category">カテゴリ</TabsTrigger>
            <TabsTrigger value="sync">同期</TabsTrigger>
          </TabsList>

          <TabsContent value="api" className="mt-4">
            <ApiSettings />
          </TabsContent>

          <TabsContent value="category" className="mt-4">
            <CategorySettings />
          </TabsContent>

          <TabsContent value="sync" className="mt-4">
            <SyncSettings />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
