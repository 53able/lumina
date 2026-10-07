/**
 * テスト用の Web Locks API（navigator.locks）の代わり
 *
 * CI の Node と jsdom には navigator.locks が無いため、排他ロック（exclusive）の
 * request（ifAvailable・signal を含む）だけを同じ規則で実装する。別のタブが持つロックは、
 * 同じ LockManager に対する別の request で表す（タブを閉じた＝その request の callback が終わる）。
 */
type LockCallback = (lock: Lock | null) => unknown;

export class FakeLockManager {
  private readonly held = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  request(name: string, callback: LockCallback): Promise<unknown>;
  request(name: string, options: LockOptions, callback: LockCallback): Promise<unknown>;
  async request(
    name: string,
    optionsOrCallback: LockOptions | LockCallback,
    maybeCallback?: LockCallback
  ): Promise<unknown> {
    const [options, callback] =
      typeof optionsOrCallback === "function"
        ? [{} as LockOptions, optionsOrCallback]
        : [optionsOrCallback, maybeCallback as LockCallback];
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      // 解放されたら順番に渡す（渡す間 held から外さない）。signal の中止で待つのをやめる
      await new Promise<void>((resolve, reject) => {
        const { signal } = options;
        const grant = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          this.waiters.set(
            name,
            (this.waiters.get(name) ?? []).filter((waiter) => waiter !== grant)
          );
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", abort, { once: true });
        this.waiters.set(name, [...(this.waiters.get(name) ?? []), grant]);
      });
    }
    this.held.add(name);
    try {
      return await callback({ name, mode: "exclusive" } as Lock);
    } finally {
      const next = this.waiters.get(name)?.shift();
      if (next) next();
      else this.held.delete(name);
    }
  }

  /** ロックを持っているか */
  isHeld(name: string): boolean {
    return this.held.has(name);
  }
}

/** navigator.locks を差し替える。戻り値で元に戻す */
const replaceLocks = (value: unknown): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { value, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
    else delete (navigator as { locks?: unknown }).locks;
  };
};

/** navigator.locks をテスト用の LockManager にする */
export const installFakeLockManager = (): { locks: FakeLockManager; restore: () => void } => {
  const locks = new FakeLockManager();
  return { locks, restore: replaceLocks(locks) };
};

/** navigator.locks を無くす（Web Locks の無い環境）。戻り値で元に戻す */
export const removeLockManager = (): (() => void) => replaceLocks(undefined);
