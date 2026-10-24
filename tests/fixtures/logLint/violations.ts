// lint:logs（package.json）が違反を検出できることを確かめるためのサンプル。
// lint:logs:selftest（package.json）が、同じ正規表現をこのディレクトリに当てて一致があることを確かめる。
// tsconfig・biome・vitest の対象外（tests/ は include に入っておらず、ファイル名も *.test.ts ではない）
declare const logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};
declare const err: Error;
declare const level: "info" | "warn" | "error";

// 違反: 1行のテンプレートリテラル
logger.error(`sync failed: ${err}`);

// 違反: 複数行にまたがるテンプレートリテラル
logger.warn(
  { chunkStart: 0 },
  `sync embedding stopped
  at chunk 0`
);

// 違反: .message
logger.error({ detail: err.message }, "sync failed");

// 違反: .stack
logger.error(
  {
    stack: err.stack,
  },
  "sync failed"
);

// 違反: String(
logger.info({ reason: String(err) }, "skipped");

// 違反: JSON.stringify(
logger.error({ body: JSON.stringify(err) }, "sync failed");

// 違反ではない（検出されないこと）
logger.error({ code: "internal", err }, "sync failed");

// 違反: level を変数で選ぶ呼び出しでも、エラーを文字列にして渡す
logger[level]({ detail: err.message }, "summary failed");
