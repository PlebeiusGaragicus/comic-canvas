import { useRef, useState } from 'react';
import { api } from './api';
import { Modal } from './ui';
import { formatRequestError } from './formatError';
import { exportProject, importProject } from './store/zip';
import { isBlobStoreSupported } from './store/blobs';
import type { Project } from './types';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ProjectLanding({
  projects,
  error,
  onOpen,
  onCreated,
  onImported,
  onOpenSettings,
}: {
  projects: Project[];
  error: string | null;
  onOpen: (slug: string) => void;
  onCreated: (slug: string) => void;
  /** Called after a zip/folder import; the landing reloads the project list. */
  onImported?: (slug: string) => void | Promise<void>;
  onOpenSettings?: () => void;
}) {
  const [name, setName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storeSupported = isBlobStoreSupported();
  const canPickDirectory = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setName('');
  };
  const create = async () => {
    const nextSlug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!nextSlug || creating) return;
    setCreating(true);
    setLocalError(null);
    try {
      await api.createProject(nextSlug, name, {});
      setName('');
      setCreateOpen(false);
      onCreated(nextSlug);
    } catch (err) {
      setLocalError(formatRequestError(err));
    } finally {
      setCreating(false);
    }
  };

  const runImport = async (source: File | FileSystemDirectoryHandle) => {
    setBusy('import');
    setLocalError(null);
    try {
      const { slug } = await importProject(source, { onConflict: 'rename' });
      await onImported?.(slug);
    } catch (err) {
      setLocalError(formatRequestError(err));
    } finally {
      setBusy(null);
    }
  };

  const importFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker();
      await runImport(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLocalError(formatRequestError(err));
    }
  };

  const exportOne = async (project: Project) => {
    setBusy('export');
    setLocalError(null);
    try {
      downloadBlob(await exportProject(project.slug), `${project.slug}.zip`);
    } catch (err) {
      setLocalError(formatRequestError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="landing">
      <div className="landing-content">
        <header className="landing-masthead">
          <span className="landing-logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="44" height="44" fill="none">
              <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent-strong)" />
              <rect x="7" y="7" width="8" height="7" rx="1.5" fill="#fff" opacity="0.95" />
              <rect x="17" y="7" width="8" height="10" rx="1.5" fill="#fff" opacity="0.6" />
              <rect x="7" y="17" width="8" height="8" rx="1.5" fill="#fff" opacity="0.6" />
              <rect x="17" y="20" width="8" height="5" rx="1.5" fill="#fff" opacity="0.95" />
            </svg>
          </span>
          <h1 className="landing-title">Comic Canvas</h1>
          <p className="landing-tagline">Turn a manuscript into a laid-out, illustrated comic.</p>
          {onOpenSettings && (
            <button
              type="button"
              className="icon-button landing-settings-button"
              title="Settings"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              ⚙
            </button>
          )}
        </header>
        {!storeSupported && (
          <p className="error error-banner landing-error">
            This browser cannot store projects: it lacks writable private file storage. Use Chrome, Edge, Firefox, or Safari 26 or newer.
          </p>
        )}
        {(error || localError) && <p className="error error-banner landing-error">{localError ?? error}</p>}
        <div className="project-list">
          {projects.map((project) => (
            <div key={project.slug} className="project-tile-wrap">
              <button className="project-tile" onClick={() => onOpen(project.slug)}>
                <div className="project-tile-cover">
                  {project.coverThumbnailUrl ? (
                    <img src={project.coverThumbnailUrl} alt="" />
                  ) : (
                    <div className="project-tile-cover-placeholder" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <circle cx="8.5" cy="10" r="1.5" />
                        <path d="M21 16l-4.5-4.5L7 21" />
                      </svg>
                    </div>
                  )}
                </div>
                <strong className="project-tile-name">{project.name}</strong>
              </button>
              <button
                type="button"
                className="secondary project-tile-export"
                title={`Export ${project.name} as a zip`}
                aria-label={`Export ${project.name}`}
                disabled={busy !== null}
                onClick={() => void exportOne(project)}
              >
                ⇩
              </button>
            </div>
          ))}
          <button className="project-tile project-create-tile" onClick={() => setCreateOpen(true)} disabled={!storeSupported}>
            <div className="project-tile-cover project-create-cover" aria-hidden="true">+</div>
            <span className="project-tile-name">New project</span>
          </button>
        </div>
        <div className="landing-actions">
          <button type="button" className="secondary" disabled={busy !== null || !storeSupported} onClick={() => fileInputRef.current?.click()}>
            {busy === 'import' ? 'Importing…' : 'Import project (zip)'}
          </button>
          {canPickDirectory && (
            <button type="button" className="secondary" disabled={busy !== null || !storeSupported} onClick={() => void importFolder()}>
              Import project folder
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void runImport(file);
            }}
          />
        </div>
      </div>
      {createOpen && (
        <Modal title="New project" onClose={closeCreate}>
          <label className="field-label">
            Project name
            <input
              autoFocus
              value={name}
              disabled={creating}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
              placeholder="My project"
            />
          </label>
          <div className="modal-actions">
            <button className="secondary" disabled={creating} onClick={closeCreate}>Cancel</button>
            <button disabled={creating || !name.trim()} onClick={() => void create()}>
              {creating ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
