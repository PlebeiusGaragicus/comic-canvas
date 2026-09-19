import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/** Re-run `reposition` while `active`, on window resize and any scroll (capture). */
export function useRepositionOnViewportChange(active: boolean, reposition: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = () => reposition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [active, reposition]);
}

/**
 * Call `onDismiss` on pointerdown outside all `refs` while `active`.
 * Escape also dismisses by default (capture phase, so canvas-level Escape
 * handlers don't co-fire while a popover is open).
 */
export function useDismissOnOutsidePointerDown(
  active: boolean,
  refs: Array<RefObject<HTMLElement | null>>,
  onDismiss: () => void,
  options: { escape?: boolean } = {},
) {
  const escape = options.escape ?? true;
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    if (escape) document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      if (escape) document.removeEventListener('keydown', onKeyDown, true);
    };
    // refs is a fresh array each render but its RefObject members are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, escape, onDismiss]);
}

/**
 * Roving keyboard navigation for a `role="menu"` container: ArrowUp/Down and
 * Home/End move focus among enabled menuitems; Escape closes. Attach the
 * returned handler to the menu container's onKeyDown; call `focusFirst`
 * from an effect when the menu opens.
 */
export function menuKeyboardHandlers(containerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const items = () =>
    Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );

  const focusFirst = () => {
    items()[0]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = items();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(list.length - 1);
        break;
      case 'Escape':
        event.stopPropagation();
        onClose();
        break;
      default:
    }
  };

  return { onKeyDown, focusFirst };
}
