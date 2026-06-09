interface LatestAsyncRunOptions<T> {
  before?: () => void;
  execute: () => Promise<T>;
  commit: (value: T) => void;
  fail?: (error: unknown) => void;
  settle?: () => void;
}

export function useLatestAsyncRun() {
  let latestRun = 0;

  function start() {
    latestRun += 1;
    return latestRun;
  }

  function isCurrent(run: number) {
    return run === latestRun;
  }

  async function runLatest<T>(options: LatestAsyncRunOptions<T>) {
    const run = start();
    options.before?.();
    try {
      const value = await options.execute();
      if (!isCurrent(run)) return false;
      options.commit(value);
      return true;
    } catch (e) {
      if (!isCurrent(run)) return false;
      options.fail?.(e);
      return true;
    } finally {
      if (isCurrent(run)) {
        options.settle?.();
      }
    }
  }

  return {
    start,
    isCurrent,
    runLatest,
  };
}
