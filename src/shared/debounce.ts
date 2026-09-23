import { useCallback, useEffect, useRef } from 'react';

/**
 * Trailing-edge debounce for an async writer. `call` schedules with the
 * latest args; `flush` runs any pending write immediately (also invoked on
 * unmount). The wrapped fn owns its error handling — `call` returns void.
 */
export function useDebouncedAsyncCallback<T extends unknown[]>(
  fn: (...args: T) => Promise<void> | void,
  delayMs: number,
) {
  const timer = useRef<number | null>(null);
  const lastArgs = useRef<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (lastArgs.current) {
      const args = lastArgs.current;
      lastArgs.current = null;
      await fnRef.current(...args);
    }
  }, []);

  const call = useCallback((...args: T) => {
    lastArgs.current = args;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, delayMs);
  }, [delayMs, flush]);

  useEffect(() => {
    const onBeforeUnload = () => {
      void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flush();
    };
  }, [flush]);

  return { call, flush };
}
