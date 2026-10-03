import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Paper } from "../../shared/schemas/index";
import type { LuminaDB } from "../db/db";
import {
  createDefaultPaperIndexClient,
  type PaperIndexClient,
  PaperLoadError,
} from "../lib/paperIndex/client";
import {
  mergePapersDesc,
  type PaperListItem,
  type PaperSearchMatches,
  type PaperSearchSource,
  toPaperListItem,
  toStoredPaper,
} from "../lib/paperIndex/core";

/**
 * 保存済み論文の読み込み状態
 * - idle: 未開始
 * - loading: 段階的に読み込み中（一覧は読み込み済みの分だけ表示する）
 * - ready: 全件の準備完了（検索・同期はここから）
 * - error: 読み込み失敗・検索用データが使えない（再試行できる）
 */
export type PaperLoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * paperStore の状態型
 */
interface PaperState {
  /** 一覧用の論文（公開日の降順。Embedding 本体は持たず、検索用索引にだけ置く） */
  papers: PaperListItem[];
  /** 保存済み論文の読み込み状態 */
  loadStatus: PaperLoadStatus;
  /** 読み込み済みの件数 */
  loadedCount: number;
  /** 保存済みの総件数（読み込み開始直後は null） */
  totalCount: number | null;
  /** 読み込みの失敗 */
  loadError: Error | null;
  /** 全件の準備が終わるまで true（読み込み失敗時は false） */
  isLoading: boolean;
  /** DBインスタンス（内部用） */
  _db: LuminaDB | null;
  /** 検索用索引のクライアント（内部用） */
  _index: PaperIndexClient | null;
}

/**
 * paperStore のアクション型
 */
interface PaperActions {
  /** 論文を追加する（既存の場合は更新）。全件の準備完了を待ってから保存する */
  addPaper: (paper: Paper) => Promise<void>;
  /** 複数の論文を一括追加する。全件の準備完了を待ってから保存する */
  addPapers: (papers: Paper[]) => Promise<void>;
  /** IDで論文を取得する */
  getPaperById: (id: string) => PaperListItem | undefined;
  /** 全件の準備完了を待ってから検索用索引を検索する */
  searchPapers: (
    queryEmbedding: number[],
    scoreThreshold: number,
    limit: number
  ) => Promise<PaperSearchMatches>;
  /** 読み込みをやり直す（失敗時の再試行。表示中の一覧は消さずに統合する） */
  retryLoad: () => Promise<void>;
}

type PaperStore = PaperState & PaperActions;

/** 先頭バッチの後、一覧へ反映する最短間隔（ms）。バッチごとの再描画を間引く */
const BATCH_FLUSH_INTERVAL_MS = 300;

/** 読み込みの世代（再試行で古い読み込みの結果を採用しないため） */
let loadGeneration = 0;

/** 実行中の読み込みの Promise を resolve する（新しい読み込みに置き換えられたときに呼ぶ） */
let resolveCurrentLoad: (() => void) | null = null;

/** 索引クライアントの生成関数（initializePaperStore で差し替えられる。再試行でも使う） */
let createIndexClient: (db: LuminaDB) => PaperIndexClient = createDefaultPaperIndexClient;

/** 計測用のマーク（console には出さない） */
const markPerformance = (name: string) => {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    performance.mark(name);
  }
};

/**
 * 保存済み論文の全件準備完了を待つ
 *
 * ready なら即 resolve、error なら reject、読み込み中・未開始なら完了か失敗まで待つ。
 * 呼び出しごとに購読して Promise を作る（共有 Promise の未処理 reject を出さないため）。
 */
export const whenPapersReady = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const settle = (state: PaperState): boolean => {
      if (state.loadStatus === "ready") {
        resolve();
        return true;
      }
      if (state.loadStatus === "error") {
        reject(state.loadError ?? new PaperLoadError("保存済みの論文を読み込めませんでした"));
        return true;
      }
      return false;
    };
    if (settle(usePaperStore.getState())) return;
    const unsubscribe = usePaperStore.subscribe((state) => {
      if (settle(state)) unsubscribe();
    });
  });

/**
 * 保存する論文を組み立てる。
 * Embedding を持たない論文（一覧用の論文を元にした更新など）で、保存済みの Embedding を消さない。
 */
const withStoredEmbeddings = async (db: LuminaDB, papers: Paper[]): Promise<Paper[]> => {
  const stored = papers.map(toStoredPaper);
  const missingIds = stored
    .filter((p) => !p.embedding || p.embedding.length === 0)
    .map((p) => p.id);
  if (missingIds.length === 0) return stored;

  const existing = await db.papers.bulkGet(missingIds);
  const existingEmbeddings = new Map<string, number[]>();
  for (const paper of existing) {
    if (paper?.embedding && paper.embedding.length > 0) {
      existingEmbeddings.set(paper.id, paper.embedding);
    }
  }
  return stored.map((paper) => {
    const embedding = existingEmbeddings.get(paper.id);
    return embedding && (!paper.embedding || paper.embedding.length === 0)
      ? { ...paper, embedding }
      : paper;
  });
};

/**
 * paperStore - 論文データの管理
 *
 * Zustand + IndexedDB永続化。
 * 一覧用の論文だけを保持し、Embedding と類似度計算は検索用索引（Web Worker）に任せる。
 */
export const usePaperStore = create<PaperStore>()(
  devtools(
    (set, get) => {
      /**
       * 論文を保存し、索引・一覧へ反映する。
       * 不変条件: 索引への反映（upsert の送信）は一覧の更新より前に行う
       * （一覧の更新で再計算した検索が、更新後の索引を参照するため）。
       */
      const savePapers = async (papers: Paper[]): Promise<void> => {
        const db = get()._db;
        if (!db) throw new Error("DB not initialized");
        // 読み込み中の書き込みで既存論文を新規と取り違えないよう、全件の準備完了を待つ
        await whenPapersReady();
        if (papers.length === 0) return;

        // 保存済み Embedding の読み取りと保存を1つのトランザクションで行う（間に入った補完を上書きしない）
        const stored = await db.transaction("rw", db.papers, async () => {
          const merged = await withStoredEmbeddings(db, papers);
          await db.papers.bulkPut(merged);
          return merged;
        });
        get()._index?.upsert(stored);
        set((state) => ({ papers: mergePapersDesc(state.papers, stored.map(toPaperListItem)) }));
      };

      return {
        // State
        papers: [],
        loadStatus: "idle",
        loadedCount: 0,
        totalCount: null,
        loadError: null,
        isLoading: false,
        _db: null,
        _index: null,

        // Actions
        addPaper: (paper) => savePapers([paper]),

        addPapers: (papers) => savePapers(papers),

        getPaperById: (id) => {
          return get().papers.find((p) => p.id === id);
        },

        searchPapers: async (queryEmbedding, scoreThreshold, limit) => {
          await whenPapersReady();
          const index = get()._index;
          if (!index) throw new PaperLoadError("検索用データがありません。再読み込みしてください");
          return index.search(queryEmbedding, scoreThreshold, limit);
        },

        retryLoad: async () => {
          const db = get()._db;
          if (!db) throw new Error("DB not initialized");
          await startPaperLoad(db);
        },
      };
    },
    { name: "paper-store" }
  )
);

/**
 * 検索の実行元（paperStore の索引を使う）
 * useSemanticSearch の既定値。全件の準備完了を待ってから検索する。
 */
export const paperStoreSearchSource: PaperSearchSource = {
  isReady: () => usePaperStore.getState().loadStatus === "ready",
  whenReady: whenPapersReady,
  search: (queryEmbedding, scoreThreshold, limit) =>
    usePaperStore.getState().searchPapers(queryEmbedding, scoreThreshold, limit),
};

/**
 * 保存済み論文の読み込みを開始する
 *
 * 一覧は先頭バッチを即時に、以降は BATCH_FLUSH_INTERVAL_MS 間隔でまとめて反映する。
 * 再試行時は表示中の一覧を消さず、届いたバッチを統合する。
 *
 * @returns ready・error になったとき、または新しい読み込みに置き換えられたときに resolve する（reject しない）
 */
const startPaperLoad = (db: LuminaDB): Promise<void> => {
  // 置き換えられる読み込みの結果は採用しないが、待っている呼び出し元は待たせ続けない
  resolveCurrentLoad?.();
  resolveCurrentLoad = null;
  loadGeneration += 1;
  const generation = loadGeneration;
  const isCurrent = () => generation === loadGeneration;

  usePaperStore.getState()._index?.dispose();
  usePaperStore.setState({
    _db: db,
    _index: null,
    loadStatus: "loading",
    isLoading: true,
    loadError: null,
    loadedCount: 0,
    totalCount: null,
  });

  return new Promise<void>((resolve) => {
    resolveCurrentLoad = resolve;
    /** 一覧へ未反映のバッチ */
    let pending: PaperListItem[] = [];
    let pendingLoadedCount = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;
    let hasFlushed = false;

    const flush = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!isCurrent() || pending.length === 0) return;
      const incoming = pending;
      pending = [];
      lastFlushAt = Date.now();
      usePaperStore.setState((state) => ({
        papers: mergePapersDesc(state.papers, incoming),
        loadedCount: pendingLoadedCount,
      }));
      if (!hasFlushed) {
        hasFlushed = true;
        markPerformance("lumina:first-papers-rendered");
      }
    };

    const fail = (error: Error) => {
      flush();
      if (!isCurrent()) return;
      usePaperStore.setState({ loadStatus: "error", isLoading: false, loadError: error });
      resolve();
    };

    let index: PaperIndexClient;
    try {
      index = createIndexClient(db);
    } catch (error) {
      fail(
        new PaperLoadError(
          `検索用データを準備できませんでした: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      return;
    }
    usePaperStore.setState({ _index: index });

    index.load({
      onProgress: (total) => {
        if (isCurrent()) usePaperStore.setState({ totalCount: total });
      },
      onBatch: (papers, loadedCount) => {
        if (!isCurrent()) return;
        pending = pending.concat(papers);
        pendingLoadedCount = loadedCount;
        const elapsed = Date.now() - lastFlushAt;
        if (!hasFlushed || elapsed >= BATCH_FLUSH_INTERVAL_MS) {
          flush();
        } else if (flushTimer === null) {
          flushTimer = setTimeout(flush, BATCH_FLUSH_INTERVAL_MS - elapsed);
        }
      },
      onLoaded: (loadedCount) => {
        pendingLoadedCount = loadedCount;
        flush();
        if (!isCurrent()) return;
        usePaperStore.setState({
          loadStatus: "ready",
          isLoading: false,
          loadedCount,
          totalCount: loadedCount,
        });
        markPerformance("lumina:papers-ready");
        resolve();
      },
      // 完了後に索引が使えなくなった場合も error にする（一覧は残し、再試行で読み込み直す）
      onError: fail,
    });
  });
};

/**
 * paperStoreを初期化する
 * 保存済みの論文を検索用索引（Web Worker）で段階的に読み込み、一覧へ反映する。
 * 描画を待たせないため、呼び出し元は戻り値を待たなくてよい。
 *
 * @param db LuminaDBインスタンス
 * @param options createIndexClient: 索引クライアントの生成関数（テスト用。既定は Worker）
 * @returns ready または error になったら resolve する（reject しない）
 */
export const initializePaperStore = (
  db: LuminaDB,
  options: { createIndexClient?: (db: LuminaDB) => PaperIndexClient } = {}
): Promise<void> => {
  createIndexClient = options.createIndexClient ?? createDefaultPaperIndexClient;
  usePaperStore.setState({ papers: [] });
  return startPaperLoad(db);
};
