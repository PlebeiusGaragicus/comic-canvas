import { useRef, useState } from 'react';
import type { InsertDraftPayload } from './storyPanelSidebar';

export function StorySetupView({
  onImportBook,
  onAddPanel,
  isSaving,
}: {
  onImportBook: (file: File) => Promise<void>;
  onAddPanel: (payload: InsertDraftPayload) => Promise<void>;
  isSaving: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [panelText, setPanelText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const submitFirstPanel = async () => {
    const text = panelText.trim();
    if (!text) return;
    setIsCreating(true);
    try {
      await onAddPanel({ storyText: text, insertAfterPanelId: null });
      setPanelText('');
    } finally {
      setIsCreating(false);
    }
  };

  const handleBookUpload = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      await onImportBook(file);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const busy = isSaving || isCreating || isUploading;

  return (
    <div className="story-setup-view">
      <div className="story-setup-header">
        <h2>Start your story</h2>
        <p className="muted">Write panels one at a time, or upload source text to highlight passages into panels.</p>
      </div>
      <div className="story-setup-options">
        <section className="story-setup-card">
          <h3>Write panels</h3>
          <p className="muted">Build the story beat by beat. Your first panel is placed on the layout automatically.</p>
          <label className="story-setup-field">
            First panel
            <textarea
              value={panelText}
              rows={5}
              disabled={busy}
              placeholder="Once upon a time, in a quiet village..."
              onChange={(event) => setPanelText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submitFirstPanel();
                }
              }}
            />
          </label>
          <button type="button" disabled={busy || !panelText.trim()} onClick={() => void submitFirstPanel()}>
            {isCreating ? 'Adding…' : 'Add first panel'}
          </button>
        </section>
        <section className="story-setup-card">
          <h3>Upload book.txt</h3>
          <p className="muted">Import your manuscript, then select passages in Story to turn them into panels.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            disabled={busy}
            onChange={(event) => void handleBookUpload(event.target.files?.[0])}
          />
          <button type="button" className="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {isUploading ? 'Uploading…' : 'Upload book.txt'}
          </button>
        </section>
      </div>
    </div>
  );
}
