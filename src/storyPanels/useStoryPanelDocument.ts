import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyCanvas } from '../shared/canvasDefaults';
import { formatRequestError } from '../formatError';
import { api } from '../api';
import type { Asset, CanvasDocument, StoryPanelDocument, TagDefinition } from '../types';
import { sortedPanels } from './storyPanelUtils';
import { topLevelPanels } from './panelModel';


export function useStoryPanelDocument(projectSlug: string, options?: { withCanvasContext?: boolean }) {
  const withCanvasContext = options?.withCanvasContext ?? false;
  const [bookText, setBookText] = useState('');
  const [document, setDocument] = useState<StoryPanelDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projectTags, setProjectTags] = useState<TagDefinition[]>([]);
  const [canvas, setCanvas] = useState<CanvasDocument>(emptyCanvas);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const panels = await api.getStoryPanels(projectSlug);
      setDocument(panels);
      try {
        const book = await api.getStoryPanelBook(projectSlug);
        setBookText(book.text);
      } catch (bookErr) {
        // A project without book.txt is a normal state; a failed request is not.
        console.error('[photo-web] failed to load book text', bookErr);
        setBookText('');
        setError(formatRequestError(bookErr));
      }
      if (withCanvasContext) {
        const [projectDetail, nextCanvas] = await Promise.all([
          api.getProject(projectSlug),
          api.getCanvas(projectSlug),
        ]);
        setAssets(projectDetail.assets);
        setProjectTags(projectDetail.tags);
        setCanvas(nextCanvas);
      }
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectSlug, withCanvasContext]);

  useEffect(() => {
    void load();
  }, [load]);

  const panels = useMemo(() => sortedPanels(document?.panels ?? []), [document]);
  const storyPanels = useMemo(
    () => topLevelPanels(panels),
    [panels],
  );
  const sidebarPanels = useMemo(
    () => panels.filter((panel) => panel.sourceKind === 'bookmark' || (panel.sourceKind === 'panel' && panel.parentPanelId == null)),
    [panels],
  );

  const saveDocument = async (nextDocument: StoryPanelDocument) => {
    setIsSaving(true);
    setError(null);
    try {
      const saved = await api.saveStoryPanels(projectSlug, nextDocument);
      setDocument(saved);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const deletePanel = async (panelId: string) => {
    setIsSaving(true);
    setError(null);
    try {
      const next = await api.deleteStoryPanel(projectSlug, panelId);
      setDocument(next);
      return next;
    } catch (err) {
      setError(formatRequestError(err));
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    bookText,
    document,
    panels,
    storyPanels,
    sidebarPanels,
    isLoading,
    isSaving,
    error,
    setError,
    setDocument,
    saveDocument,
    deletePanel,
    assets,
    projectTags,
    canvas,
    reload: load,
  };
}
