import { useEffect, useMemo, useState } from 'react';
import { SplitTagPopover } from '../canvas/splitTagPopover';
import { assetLabel } from '../canvas/shared';
import type { Asset, CanvasDocument, TagDefinition } from '../types';
import {
  assetThumbnailUrl,
  filterPickableAssets,
  pickerTagCounts,
} from './panelImageAssets';

export function PanelImagePicker({
  projectSlug,
  panelLabel,
  assets,
  projectTags,
  canvas,
  currentActiveAssetId,
  onSelect,
  onClose,
}: {
  projectSlug: string;
  panelLabel: string;
  assets: Asset[];
  projectTags: TagDefinition[];
  canvas: CanvasDocument;
  currentActiveAssetId?: string | null;
  onSelect: (assetId: string) => void;
  onClose: () => void;
}) {
  const [showAllLibrary, setShowAllLibrary] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeUserTags, setActiveUserTags] = useState<string[]>([]);
  const [activeEntityTags, setActiveEntityTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tagMeta = useMemo(
    () => pickerTagCounts(assets, canvas, projectTags, showAllLibrary, showArchived),
    [assets, canvas, projectTags, showAllLibrary, showArchived],
  );

  const filteredAssets = useMemo(
    () => filterPickableAssets({
      assets,
      canvas,
      projectTags,
      showAllLibrary,
      showArchived,
      activeUserTags,
      activeEntityTags,
      searchQuery,
    }),
    [activeEntityTags, activeUserTags, assets, canvas, projectTags, searchQuery, showAllLibrary, showArchived],
  );

  return (
    <div className="panel-image-picker-backdrop" onClick={onClose}>
      <div
        className="panel-image-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-image-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-image-picker-head">
          <h2 id="panel-image-picker-title">Choose image — {panelLabel}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="panel-image-picker-body">
          <aside className="panel-image-picker-sidebar">
            <fieldset className="panel-image-picker-scope">
              <legend>Scope</legend>
              <label>
                <input
                  type="radio"
                  name="panel-image-picker-scope"
                  checked={!showAllLibrary}
                  onChange={() => setShowAllLibrary(false)}
                />
                On canvas
              </label>
              <label>
                <input
                  type="radio"
                  name="panel-image-picker-scope"
                  checked={showAllLibrary}
                  onChange={() => setShowAllLibrary(true)}
                />
                All library
              </label>
            </fieldset>
            <SplitTagPopover
              mode="filter"
              className="panel-image-picker-tags"
              userSelectedTags={activeUserTags}
              userAvailableTags={tagMeta.userAvailableTags}
              userTagCounts={tagMeta.userTagCounts}
              onUserTagsChange={setActiveUserTags}
              entitySelectedTags={activeEntityTags}
              characterAvailableTags={tagMeta.characterAvailableTags}
              locationAvailableTags={tagMeta.locationAvailableTags}
              entityTagCounts={tagMeta.entityTagCounts}
              onEntityTagsChange={setActiveEntityTags}
              footer={(
                <button
                  type="button"
                  className={showArchived ? 'is-active' : ''}
                  onClick={() => setShowArchived((current) => !current)}
                >
                  {showArchived ? 'Hide archived' : 'Show archived'}
                </button>
              )}
            />
          </aside>
          <section className="panel-image-picker-main">
            <input
              className="panel-image-picker-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search images…"
              autoFocus
            />
            {filteredAssets.length === 0 ? (
              <p className="muted panel-image-picker-empty">No images match the current filters.</p>
            ) : (
              <div className="panel-image-picker-grid">
                {filteredAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={`panel-image-picker-tile ${asset.id === currentActiveAssetId ? 'is-active' : ''}`}
                    onClick={() => onSelect(asset.id)}
                  >
                    <img src={assetThumbnailUrl(projectSlug, asset)} alt="" />
                    <span>{assetLabel(asset)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
