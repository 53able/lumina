import type { Paper } from "../../../shared/schemas/index";
import type { LuminaDB } from "../../db/schema";

/** streamPapers のオプション */
export interface StreamPapersOptions {
  /** 先頭バッチの件数（最新の論文を先に表示するため小さくする） */
  firstBatchSize: number;
  /** 2回目以降のバッチの件数 */
  batchSize: number;
  /** 総件数が分かったときに呼ぶ */
  onTotal: (total: number) => void;
  /** バッチごとに呼ぶ（loadedCount はこのバッチまでの累計件数） */
  onBatch: (papers: Paper[], loadedCount: number) => void;
}

/**
 * 保存済みの論文を公開日の降順にバッチで読み込む
 *
 * 単一の読み取りトランザクション内で総件数とカーソルを読む（読み込み中に件数と内容がずれないようにする）。
 * トランザクションが閉じないよう、バッチ間で await や setTimeout による待機はしない。
 *
 * @param db LuminaDB インスタンス
 * @param options バッチの件数とコールバック
 * @returns 読み込んだ件数
 */
export const streamPapers = (db: LuminaDB, options: StreamPapersOptions): Promise<number> =>
  db.transaction("r", db.papers, async () => {
    const { firstBatchSize, batchSize, onTotal, onBatch } = options;

    // 件数の取得は大量データで約1秒かかるため、先頭バッチを送ってから要求する（先頭の論文の表示を待たせない）
    let countRequest: Promise<void> | null = null;
    const requestTotal = () => {
      countRequest ??= db.papers.count().then(onTotal);
    };

    let batch: Paper[] = [];
    let currentBatchSize = firstBatchSize;
    let loadedCount = 0;
    const flush = () => {
      loadedCount += batch.length;
      onBatch(batch, loadedCount);
      batch = [];
      currentBatchSize = batchSize;
      requestTotal();
    };

    await db.papers
      .orderBy("publishedAt")
      .reverse()
      .each((paper) => {
        batch.push(paper);
        if (batch.length >= currentBatchSize) flush();
      });
    if (batch.length > 0) flush();
    // 空の DB でも総件数（0）を通知する
    requestTotal();
    await countRequest;

    return loadedCount;
  });
