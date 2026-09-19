import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab focus inside `ref` while mounted; focus `[data-autofocus]` (or the
 * first focusable) on mount and restore focus to the previously focused
 * element on unmount.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, options: { autoFocus?: boolean } = {}) {
  const autoFocus = options.autoFocus ?? true;
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;
    if (autoFocus) {
      const target = container.querySelector<HTMLElement>('[data-autofocus]')
        ?? container.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

let scrollLockCount = 0;

/** Lock body scrolling while `active`; nest-safe via a module counter. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    scrollLockCount += 1;
    if (scrollLockCount === 1) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [active]);
}
