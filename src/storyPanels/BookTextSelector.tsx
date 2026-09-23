import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissOnOutsidePointerDown } from '../shared/popover';
import type { StoryPanel } from '../types';
import { bookAnchorPanels } from './storyPanelSidebar';
import { isBookLinked, isPanel } from './panelModel';

export type TextSelectionRange = {
  startOffset: number;
  endOffset: number;
  selectedText: string;
};

type MenuState =
  | { kind: 'selection'; x: number; y: number }
  | { kind: 'anchor'; panelId: string; x: number; y: number };

type BoundaryDrag = {
  panelId: string;
  side: 'start' | 'end';
};

type TextPiece = {
  text: string;
  storyId?: string;
  bookmarkId?: string;
  isSelection?: boolean;
};

function buildTextPieces(bookText: string, panels: StoryPanel[], selection: TextSelectionRange | null): TextPiece[] {
  const anchors = bookAnchorPanels(panels);
  const boundaries = new Set<number>([0, bookText.length]);
  for (const panel of anchors) {
    boundaries.add(panel.startOffset!);
    boundaries.add(panel.endOffset!);
  }
  if (selection) {
    boundaries.add(selection.startOffset);
    boundaries.add(selection.endOffset);
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  const pieces: TextPiece[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start >= end) continue;
    const covering = anchors.filter((panel) => panel.startOffset! <= start && panel.endOffset! >= end);
    const story = covering.find((panel) => isPanel(panel));
    const bookmark = covering.find((panel) => panel.sourceKind === 'bookmark');
    const isSelection = Boolean(selection && selection.startOffset <= start && selection.endOffset >= end);
    pieces.push({
      text: bookText.slice(start, end),
      storyId: story?.id,
      bookmarkId: bookmark?.id,
      isSelection,
    });
  }
  return pieces;
}

export function BookTextSelector({
  bookText,
  panels,
  selection,
  focusedPanelId,
  onSelectionChange,
  onCreatePanel,
  onCreateBookmark,
  onDeletePanel,
  onAdjustPanelRange,
  onFocusPanelChunk,
  isCreating,
}: {
  bookText: string;
  panels: StoryPanel[];
  selection: TextSelectionRange | null;
  focusedPanelId: string | null;
  onSelectionChange: (selection: TextSelectionRange | null) => void;
  onCreatePanel: (options?: { openEditor?: boolean }) => Promise<void>;
  onCreateBookmark: () => Promise<void>;
  onDeletePanel: (panelId: string) => void | Promise<void>;
  onAdjustPanelRange: (panelId: string, startOffset: number, endOffset: number) => void;
  onFocusPanelChunk: (panelId: string) => void;
  isCreating: boolean;
}) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const anchorSpanRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [flashingPanelId, setFlashingPanelId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDrag | null>(null);
  const [pendingDeletePanelId, setPendingDeletePanelId] = useState<string | null>(null);
  const [isDeletingPanel, setIsDeletingPanel] = useState(false);
  const storyPanels = useMemo(
    () => panels.filter((panel) => isPanel(panel) && isBookLinked(panel)),
    [panels],
  );
  const pieces = useMemo(() => buildTextPieces(bookText, panels, selection), [bookText, panels, selection]);
  const pendingDeletePanel = pendingDeletePanelId
    ? panels.find((panel) => panel.id === pendingDeletePanelId) ?? null
    : null;

  useEffect(() => {
    if (!focusedPanelId) return;
    const panelElement = anchorSpanRefs.current[focusedPanelId];
    if (!panelElement) return;
    const scrollRoot = textRef.current;
    if (scrollRoot) {
      const panelTop = panelElement.offsetTop;
      const targetTop = panelTop - (scrollRoot.clientHeight / 2) + (panelElement.offsetHeight / 2);
      scrollRoot.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
    setFlashingPanelId(focusedPanelId);
    const timeout = window.setTimeout(() => setFlashingPanelId((current) => (current === focusedPanelId ? null : current)), 1400);
    return () => window.clearTimeout(timeout);
  }, [focusedPanelId]);

  const clearSelection = useCallback(() => {
    onSelectionChange(null);
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }, [onSelectionChange]);
  // Only listen while something is selected so Escape isn't swallowed globally.
  useDismissOnOutsidePointerDown(Boolean(selection ?? menu), [cardRef], clearSelection);

  const offsetFromPoint = (clientX: number, clientY: number): number | null => {
    const root = textRef.current;
    if (!root) return null;
    let range: Range | null = null;
    const docWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = docWithCaret.caretPositionFromPoint?.(clientX, clientY);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    } else {
      range = docWithCaret.caretRangeFromPoint?.(clientX, clientY) ?? null;
    }
    if (!range || !root.contains(range.startContainer)) return null;
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
  };

  const captureSelection = () => {
    const root = textRef.current;
    const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
    if (!root || !range || range.collapsed) return;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const selectedText = range.toString();
    const endOffset = startOffset + selectedText.length;
    if (!selectedText.trim()) return;
    const overlapsStory = storyPanels.some(
      (panel) => panel.startOffset !== null && panel.endOffset !== null && startOffset < panel.endOffset && endOffset > panel.startOffset,
    );
    if (overlapsStory) {
      setSelectionError('That passage overlaps an existing panel.');
      onSelectionChange(null);
      return;
    }
    setSelectionError(null);
    onSelectionChange({ startOffset, endOffset, selectedText });
    const rect = range.getBoundingClientRect();
    setMenu({ kind: 'selection', x: rect.left + rect.width / 2, y: rect.top });
  };

  const beginBoundaryDrag = (event: React.PointerEvent, panelId: string, side: 'start' | 'end') => {
    event.preventDefault();
    event.stopPropagation();
    setBoundaryDrag({ panelId, side });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateBoundaryDrag = (event: React.PointerEvent) => {
    if (!boundaryDrag) return;
    const offset = offsetFromPoint(event.clientX, event.clientY);
    const panel = storyPanels.find((item) => item.id === boundaryDrag.panelId);
    if (offset === null || !panel || panel.startOffset === null || panel.endOffset === null) return;
    if (boundaryDrag.side === 'start') {
      onAdjustPanelRange(panel.id, Math.max(0, Math.min(offset, panel.endOffset - 1)), panel.endOffset);
      return;
    }
    onAdjustPanelRange(panel.id, panel.startOffset, Math.min(bookText.length, Math.max(offset, panel.startOffset + 1)));
  };

  const endBoundaryDrag = () => {
    setBoundaryDrag(null);
  };

  const clearMenuForTextOffClick = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('.story-panels-text-panel')
      || target?.closest('.story-panels-text-bookmark')
      || target?.closest('.story-panels-boundary-handle')
      || target?.closest('.story-panels-text-menu')
    ) {
      return;
    }
    setMenu(null);
    onSelectionChange(null);
    window.getSelection()?.removeAllRanges();
  };

  const openAnchorMenu = (panelId: string, event: React.MouseEvent<HTMLElement>) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onFocusPanelChunk(panelId);
    setMenu({ kind: 'anchor', panelId, x: rect.left + rect.width / 2, y: rect.top });
  };

  const confirmDeletePanel = async () => {
    if (!pendingDeletePanelId) return;
    setIsDeletingPanel(true);
    try {
      await onDeletePanel(pendingDeletePanelId);
      setPendingDeletePanelId(null);
    } finally {
      setIsDeletingPanel(false);
    }
  };

  const pieceClasses = (piece: TextPiece) => {
    const classes = [];
    if (piece.storyId) classes.push('story-panels-text-panel');
    if (piece.bookmarkId) classes.push('story-panels-text-bookmark');
    if (piece.isSelection) classes.push('story-panels-text-selection');
    const anchorId = piece.storyId ?? piece.bookmarkId;
    if (anchorId === focusedPanelId) classes.push('is-focused');
    if (anchorId === flashingPanelId) classes.push('is-flashing');
    return classes.join(' ') || undefined;
  };

  const pieceAnchorId = (piece: TextPiece) => piece.storyId ?? piece.bookmarkId;

  return (
    <div ref={cardRef} className="story-panels-book-text-wrap">
      {selectionError && <p className="error story-panels-selection-error">{selectionError}</p>}
      <div
        ref={textRef}
        className="story-panels-book-text"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        onPointerDown={clearMenuForTextOffClick}
        onPointerMove={updateBoundaryDrag}
        onPointerUp={endBoundaryDrag}
        onPointerCancel={endBoundaryDrag}
      >
        {pieces.map((piece, index) => {
          const anchorId = pieceAnchorId(piece);
          return (
            <span
              key={`${anchorId ?? 'plain'}-${index}`}
              ref={anchorId ? (element) => {
                anchorSpanRefs.current[anchorId] = element;
              } : undefined}
              className={pieceClasses(piece)}
              onClick={anchorId ? (event) => openAnchorMenu(anchorId, event) : undefined}
            >
              {piece.storyId && (
                <span
                  className="story-panels-boundary-handle is-start"
                  aria-hidden="true"
                  onPointerDown={(event) => beginBoundaryDrag(event, piece.storyId!, 'start')}
                />
              )}
              {piece.text}
              {piece.storyId && (
                <span
                  className="story-panels-boundary-handle is-end"
                  aria-hidden="true"
                  onPointerDown={(event) => beginBoundaryDrag(event, piece.storyId!, 'end')}
                />
              )}
            </span>
          );
        })}
      </div>
      {menu && (
        <div className="story-panels-text-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
          {menu.kind === 'selection' ? (
            <>
              <button
                type="button"
                disabled={!selection || isCreating}
                onClick={() => {
                  void onCreatePanel().then(() => {
                    setMenu(null);
                    onSelectionChange(null);
                    window.getSelection()?.removeAllRanges();
                  });
                }}
              >
                + panel
              </button>
              <button
                type="button"
                disabled={!selection || isCreating}
                onClick={() => {
                  void onCreatePanel({ openEditor: true }).then(() => {
                    setMenu(null);
                    onSelectionChange(null);
                    window.getSelection()?.removeAllRanges();
                  });
                }}
              >
                + panel…
              </button>
              <button
                type="button"
                disabled={!selection || isCreating}
                onClick={() => {
                  void onCreateBookmark().then(() => {
                    setMenu(null);
                    onSelectionChange(null);
                    window.getSelection()?.removeAllRanges();
                  });
                }}
              >
                Bookmark
              </button>
            </>
          ) : (
            <button
              type="button"
              className="danger"
              onClick={() => {
                setMenu(null);
                setPendingDeletePanelId(menu.panelId);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {pendingDeletePanel && (
        <div className="confirm-backdrop" onClick={() => !isDeletingPanel && setPendingDeletePanelId(null)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-book-anchor-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-book-anchor-title">
              {pendingDeletePanel.sourceKind === 'bookmark' ? 'Delete bookmark?' : 'Delete panel?'}
            </h2>
            <p>
              {pendingDeletePanel.sourceKind === 'bookmark'
                ? 'This removes the bookmark from the panel list.'
                : 'This deletes the panel and removes it from the layout.'}
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={isDeletingPanel} onClick={() => setPendingDeletePanelId(null)}>Cancel</button>
              <button type="button" className="danger" disabled={isDeletingPanel} onClick={() => void confirmDeletePanel()}>
                {isDeletingPanel ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
