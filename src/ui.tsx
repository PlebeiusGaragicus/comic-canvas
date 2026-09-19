import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { useFocusTrap, useScrollLock } from './shared/focus';

export function Modal({
  title,
  onClose,
  children,
  dialogClassName,
  hideHeader = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  dialogClassName?: string;
  hideHeader?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);
  useScrollLock(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Keep canvas-level Escape handlers from co-firing behind the dialog.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`editor-dialog${dialogClassName ? ` ${dialogClassName}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={hideHeader ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {!hideHeader && (
          <div className="editor-dialog-head">
            <h2>{title}</h2>
            <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'default',
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={() => !busy && onCancel()} dialogClassName="confirm-dialog-modal" hideHeader>
      <h2>{title}</h2>
      {typeof body === 'string' ? <p>{body}</p> : body}
      <div className="row modal-actions">
        <button
          className={tone === 'danger' ? 'danger' : ''}
          disabled={busy}
          onClick={onConfirm}
          data-autofocus={tone === 'danger' ? undefined : true}
        >
          {busy ? (busyLabel ?? 'Working...') : confirmLabel}
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel} data-autofocus={tone === 'danger' ? true : undefined}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function HelpTip({ text, placement = 'bottom' }: { text: string; placement?: 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles } = useFloating({
    open,
    placement: placement === 'bottom' ? 'bottom-start' : 'top-start',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  return (
    <>
      <span className={`help-tip-wrap ${placement === 'bottom' ? 'is-below' : ''}`.trim()}>
        <button
          ref={refs.setReference}
          type="button"
          className="help-tip"
          aria-label={text}
          onClick={(event) => event.preventDefault()}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >?</button>
      </span>
      {open && createPortal(
        <span
          ref={refs.setFloating}
          className="help-tip-bubble is-portaled"
          role="tooltip"
          style={floatingStyles}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >{text}</span>,
        document.body,
      )}
    </>
  );
}

export function HoverTooltip({
  text,
  placement = 'bottom',
  children,
}: {
  text: string;
  placement?: 'top' | 'bottom' | 'right';
  children: React.ReactElement;
}) {
  const placementClass = placement === 'bottom' ? 'is-below' : placement === 'right' ? 'is-right' : '';
  return (
    <span className={`hover-tooltip-wrap ${placementClass}`.trim()}>
      {children}
      <span className="help-tip-bubble hover-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
