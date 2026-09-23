import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { menuKeyboardHandlers, useDismissOnOutsidePointerDown } from '../shared/popover';

export function HubCardMenu({
  disabled,
  ariaLabel = 'Card actions',
  onUploadImage,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  disabled?: boolean;
  ariaLabel?: string;
  onUploadImage?: () => void;
  onEdit?: () => void;
  onSetDefault?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const close = () => {
    setOpen(false);
    (refs.reference.current as HTMLElement | null)?.focus();
  };
  useDismissOnOutsidePointerDown(open, [menuRef, popoverRef], close);
  const { onKeyDown, focusFirst } = menuKeyboardHandlers(popoverRef, close);
  useEffect(() => {
    if (open) focusFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const item = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={`story-panels-chunk-menu-item${danger ? ' story-panels-chunk-menu-item--danger' : ''}`}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
        setOpen(false);
      }}
    >
      {label}
    </button>
  );

  const popover = open ? createPortal(
    <div
      ref={(node) => {
        popoverRef.current = node;
        refs.setFloating(node);
      }}
      className="story-panels-chunk-menu-popover is-portaled"
      role="menu"
      style={floatingStyles}
      onKeyDown={onKeyDown}
    >
      {onUploadImage && item('Upload image', onUploadImage)}
      {onEdit && item('Edit', onEdit)}
      {onSetDefault && item('Set as default', onSetDefault)}
      {item('Delete', onDelete, true)}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="story-panels-chunk-menu character-hub-card-menu" ref={menuRef}>
      <button
        ref={refs.setReference}
        type="button"
        className="story-panels-chunk-menu-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        ···
      </button>
      {popover}
    </div>
  );
}
