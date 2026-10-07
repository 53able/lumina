import type { LuminaDB } from "../db/db";

/**
 * 別タブへの IndexedDB の変更通知（Issue #109）
 *
 * 各ストアは起動時に IndexedDB を読んだ控えを持つため、別タブの書き込みはそのままでは反映されない。
 * 書き込んだタブが BroadcastChannel で「どのテーブルのどの論文が変わったか」を送り、
 * 受け取ったタブのストアがその部分だけを IndexedDB から読み直す。
 * 論文は数万件ありうるため、論文・要約・操作状態は論文ID単位で読み直す（全件の読み直しはしない）。
 *
 * BroadcastChannel は送信したインスタンス自身には届かないため、自タブの書き込みで読み直しは起きない。
 */
export type DbChange =
  /** 保存・更新した論文 */
  | { table: "papers"; paperIds: string[] }
  /** 要約を変更した論文（null は全件の削除） */
  | { table: "paperSummaries"; paperIds: string[] | null }
  /** いいね・ブックマークを変更した論文（null は全件の削除） */
  | { table: "userInteractions"; paperIds: string[] | null }
  /** 検索履歴（件数が少ないため全件を読み直す） */
  | { table: "searchHistories" };

/** 送受信するメッセージ（同じオリジンの別の DB への変更を取り違えないよう DB 名を付ける） */
export type DbChangeMessage = DbChange & { dbName: string };

/** BroadcastChannel の名前 */
export const DB_CHANGE_CHANNEL_NAME = "lumina-db-changes";

let channel: BroadcastChannel | null | undefined;

/** タブ内で1つのチャネルを使う（BroadcastChannel の無い環境では null） */
const getChannel = (): BroadcastChannel | null => {
  if (channel === undefined) {
    channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DB_CHANGE_CHANNEL_NAME);
    // Node（テスト）では開いたチャネルがプロセスの終了を妨げるため参照を外す（ブラウザには unref が無い）
    (channel as { unref?: () => void } | null)?.unref?.();
  }
  return channel;
};

/** 別タブへ変更を通知する（通知に失敗しても書き込み自体は成功しているため例外にしない） */
export const notifyDbChange = (db: LuminaDB, change: DbChange): void => {
  try {
    getChannel()?.postMessage({ ...change, dbName: db.name } satisfies DbChangeMessage);
  } catch (error) {
    console.warn("Failed to notify other tabs of a local data change", error);
  }
};

// 開発時の HMR でモジュールが置き換わるとき、古いチャネルを閉じる（閉じたチャネルの購読は届かなくなる）
import.meta.hot?.dispose(() => {
  channel?.close();
  channel = undefined;
});

/** 論文IDの配列か */
const isPaperIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");

/**
 * 受け取ったメッセージの形を確かめる
 * 別の版のアプリのタブなど、想定外の形のメッセージで読み直しを誤らないため
 */
export const isDbChangeMessage = (value: unknown): value is DbChangeMessage => {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.dbName !== "string") return false;
  switch (message.table) {
    case "papers":
      return isPaperIds(message.paperIds);
    case "paperSummaries":
    case "userInteractions":
      return message.paperIds === null || isPaperIds(message.paperIds);
    case "searchHistories":
      return true;
    default:
      return false;
  }
};

/**
 * 別タブからの指定テーブルの変更を購読する
 * @returns 購読の解除関数
 */
export const subscribeDbChanges = <T extends DbChange["table"]>(
  db: LuminaDB,
  table: T,
  listener: (change: Extract<DbChange, { table: T }>) => void
): (() => void) => {
  const ch = getChannel();
  if (!ch) return () => {};
  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isDbChangeMessage(message) || message.dbName !== db.name || message.table !== table) {
      return;
    }
    // table が T と一致することは上で確かめている（型引数では絞り込めないため変換する）
    listener(message as unknown as Extract<DbChange, { table: T }>);
  };
  ch.addEventListener("message", handleMessage);
  return () => ch.removeEventListener("message", handleMessage);
};

/**
 * IndexedDB から読み直してストアへ反映する（別タブの変更の反映と、初期ロードで使う）
 *
 * 読み直しの間に自タブの操作や別の読み直しがストアを更新した場合、読んだ内容はその更新より古いことがある。
 * ストアの対象部分が読み直しの前後で変わっていたら（参照が異なれば）読み直しをやり直し、
 * 新しい内容を古い内容で上書きしない。
 * maxAttempts 回続けて変わった場合は retryDelayMs 待ってから同じ手順をやり直す（反映を諦めない）。
 *
 * @returns 反映したときに resolve する
 */
export const reloadUnlessChanged = async <S, R>(
  getSnapshot: () => S,
  read: () => Promise<R>,
  apply: (result: R) => void,
  { maxAttempts = 5, retryDelayMs = 100 }: { maxAttempts?: number; retryDelayMs?: number } = {}
): Promise<void> => {
  for (;;) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const before = getSnapshot();
      const result = await read();
      if (getSnapshot() === before) {
        apply(result);
        return;
      }
    }
    console.warn(
      `Local data kept changing while reloading it (${maxAttempts} attempts); retrying in ${retryDelayMs}ms`
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
};
