/**
 * テスト用の Web Locks API（navigator.locks）の代わり
 *
 * CI の Node と jsdom には navigator.locks が無いため、排他ロック（exclusive）の
 * request（ifAvailable を含む）だけを同じ規則で実装する。別のタブが持つロックは、
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
        ? [{}, optionsOrCallback]
        : [optionsOrCallback, maybeCallback as LockCallback];
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      // 解放されたら順番に渡す（渡す間 held から外さない）
      await new Promise<void>((resolve) => {
        this.waiters.set(name, [...(this.waiters.get(name) ?? []), resolve]);
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
export const installFakeLockManager = (): { locks: FakeLockManager; restore: () => void } => {
  const locks = new FakeLockManager();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  return {
    locks,
    restore: () => {
      if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
      else delete (navigator as { locks?: unknown }).locks;
    },
  };
};
