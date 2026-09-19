import { useRef, useState } from 'react';
import clsx from 'clsx';
import type { Asset, StoryPanelDocument, StoryPanelPage } from '../types';
import { useDismissOnOutsidePointerDown } from '../shared/popover';
import { LAYOUT_PAGE_ROWS } from './printLayout';
import { panelEntriesForPage, panelPositionStyle } from './pagePanelLayout';
import { panelImageCropStyle, imageCropForPanel } from './panelImageCrop';
import { assetThumbnailUrl } from './panelImageAssets';

type FilmstripMenu = { x: number; y: number; pageId: string };

function pageShortLabel(page: StoryPanelPage, storyPageNumberById: Map<string, number>) {
  if (page.pageKind === 'cover') return 'F';
  if (page.pageKind === 'inside-cover') return 'IFC';
  if (page.pageKind === 'inside-back-cover') return 'IBC';
  if (page.pageKind === 'back-cover') return 'B';
  return String(storyPageNumberById.get(page.id) ?? '');
}

/** Collapsible bottom rail with live page miniatures: click to jump, drag a
 * story page onto another to reorder, right-click to add/delete. */
export function PageFilmstrip({
  document,
  pages,
  projectSlug,
  assetById,
  storyPageNumberById,
  leftPageIdByRightPageId,
  visiblePageIds,
  collapsed,
  disabled,
  canDeleteStoryPage,
  onCollapsedChange,
  onSelectPage,
  onMovePage,
  onAddPageAfter,
  onRequestDeletePage,
}: {
  document: StoryPanelDocument;
  pages: StoryPanelPage[];
  projectSlug: string;
  assetById: Map<string, Asset>;
  storyPageNumberById: Map<string, number>;
  leftPageIdByRightPageId: Map<string, string>;
  visiblePageIds: Set<string>;
  collapsed: boolean;
  disabled: boolean;
  canDeleteStoryPage: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onSelectPage: (pageId: string) => void;
  onMovePage: (pageId: string, targetPageId: string) => void;
  onAddPageAfter: (pageId: string) => void;
  onRequestDeletePage: (pageId: string) => void;
}) {
  const [menu, setMenu] = useState<FilmstripMenu | null>(null);
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dropTargetPageId, setDropTargetPageId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointerDown(Boolean(menu), [menuRef], () => setMenu(null));
  const menuPage = menu ? pages.find((page) => page.id === menu.pageId) ?? null : null;
  const isStory = (page: StoryPanelPage | null) => page?.pageKind === 'story';

  if (collapsed) {
    return (
      <div className="story-panels-filmstrip is-collapsed">
        <button
          type="button"
          className="story-panels-filmstrip-toggle"
          aria-expanded={false}
          onClick={() => onCollapsedChange(false)}
        >
          Pages ▴
        </button>
      </div>
    );
  }

  return (
    <div className="story-panels-filmstrip" aria-label="Pages">
      <button
        type="button"
        className="story-panels-filmstrip-toggle"
        aria-expanded
        onClick={() => onCollapsedChange(true)}
      >
        Pages ▾
      </button>
      <div className="story-panels-filmstrip-track" role="listbox" aria-label="Jump to page">
        {pages.map((page) => {
          const entries = panelEntriesForPage(document, page.id, leftPageIdByRightPageId);
          return (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={visiblePageIds.has(page.id)}
              className={clsx('story-panels-filmstrip-page', {
                'is-current': visiblePageIds.has(page.id),
                'is-fixed': page.pageKind !== 'story',
                'is-drop-target': dropTargetPageId === page.id && dragPageId !== null && dragPageId !== page.id,
                'is-drag-source': dragPageId === page.id,
              })}
              title={page.title || page.id}
              draggable={isStory(page) && !disabled}
              disabled={disabled}
              onClick={() => onSelectPage(page.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, pageId: page.id });
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                setDragPageId(page.id);
              }}
              onDragEnd={() => {
                setDragPageId(null);
                setDropTargetPageId(null);
              }}
              onDragOver={(event) => {
                if (!dragPageId || !isStory(page)) return;
                event.preventDefault();
                setDropTargetPageId(page.id);
              }}
              onDragLeave={() => {
                setDropTargetPageId((current) => (current === page.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragPageId && dragPageId !== page.id && isStory(page)) {
                  onMovePage(dragPageId, page.id);
                }
                setDragPageId(null);
                setDropTargetPageId(null);
              }}
            >
              <span className="story-panels-filmstrip-thumb">
                {entries.map(({ panel, offsetColumns }) => (
                  <span
                    key={`${panel.id}-${offsetColumns}`}
                    className={clsx('story-panels-filmstrip-panel', `is-${panel.panelKind}`)}
                    style={panelPositionStyle(panel, LAYOUT_PAGE_ROWS, offsetColumns)}
                  >
                    {panel.panelKind === 'image' && panel.activeAssetId && assetById.get(panel.activeAssetId) && (
                      <img
                        src={assetThumbnailUrl(projectSlug, assetById.get(panel.activeAssetId)!)}
                        alt=""
                        draggable={false}
                        style={panelImageCropStyle(imageCropForPanel(panel))}
                      />
                    )}
                  </span>
                ))}
              </span>
              <span className="story-panels-filmstrip-label">{pageShortLabel(page, storyPageNumberById)}</span>
            </button>
          );
        })}
      </div>
      {menu && menuPage && (
        <div
          ref={menuRef}
          className="story-panels-page-context-menu"
          style={{ left: menu.x, bottom: window.innerHeight - menu.y }}
        >
          <button
            type="button"
            disabled={disabled || !isStory(menuPage)}
            onClick={() => {
              onAddPageAfter(menu.pageId);
              setMenu(null);
            }}
          >
            Add story page after
          </button>
          <button
            type="button"
            className="danger"
            disabled={disabled || !isStory(menuPage) || !canDeleteStoryPage}
            onClick={() => {
              onRequestDeletePage(menu.pageId);
              setMenu(null);
            }}
          >
            Delete page
          </button>
        </div>
      )}
    </div>
  );
}
