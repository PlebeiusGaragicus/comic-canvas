import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { ConfirmDialog, Modal } from './ui';
import { formatRequestError } from './formatError';
import type { AppSettings, TextEndpoint, TextModelDef, ThinkingLevel } from './types';
import {
  ENDPOINT_PRESETS,
  fetchEndpointModels,
  geminiKeyConfigured,
  newEndpoint,
  readSettings,
  removeEndpoint,
  resolveDefaultTextModel,
  setDefaultTextModel,
  setGeminiApiKey,
  setThinkingLevel,
  upsertEndpoint,
  wipeAllLocalData,
  writeSettings,
} from './services/settings';
import { MODEL_CAPABILITIES, geminiProvider } from './providers/gemini';
import { isStoragePersisted, requestPersistentStorage, storageUsage, type StorageUsage } from './store/persist';
import { exportAllProjects } from './store/zip';

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function EndpointEditor({
  endpoint,
  onSaved,
  onRemoved,
}: {
  endpoint: TextEndpoint;
  onSaved: (settings: AppSettings) => void;
  onRemoved: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState<TextEndpoint>(endpoint);
  const [busy, setBusy] = useState<'save' | 'fetch' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setDraft(endpoint), [endpoint]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(endpoint);

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      onSaved(await upsertEndpoint(draft));
      setNotice('Saved.');
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async () => {
    setBusy('fetch');
    setError(null);
    setNotice(null);
    try {
      const models = await fetchEndpointModels(draft);
      const next = { ...draft, models };
      setDraft(next);
      onSaved(await upsertEndpoint(next));
      setNotice(`${models.length} model${models.length === 1 ? '' : 's'} found.`);
    } catch (err) {
      setError(formatRequestError(err));
    } finally {
      setBusy(null);
    }
  };

  const updateModel = (modelId: string, patch: Partial<TextModelDef>) => {
    setDraft((current) => ({ ...current, models: current.models.map((model) => (model.id === modelId ? { ...model, ...patch } : model)) }));
  };

  const addManualModel = () => {
    const id = window.prompt('Model id (as the server expects it):');
    if (!id?.trim()) return;
    setDraft((current) => ({
      ...current,
      models: [...current.models.filter((model) => model.id !== id.trim()), { id: id.trim(), name: id.trim(), reasoning: false, contextWindow: 128000 }],
    }));
  };

  return (
    <div className="settings-endpoint">
      <div className="settings-grid">
        <label>
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>
          Base URL
          <input value={draft.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={draft.apiKey} placeholder="Optional for local servers" onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} />
        </label>
      </div>
      <div className="settings-actions">
        <button type="button" disabled={busy !== null || !draft.baseUrl.trim()} onClick={fetchModels}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch models'}
        </button>
        <button type="button" className="secondary" disabled={busy !== null} onClick={addManualModel}>
          Add model manually
        </button>
        <button type="button" disabled={busy !== null || !dirty} onClick={save}>
          {busy === 'save' ? 'Saving…' : 'Save endpoint'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy('remove');
            try {
              onRemoved(await removeEndpoint(endpoint.id));
            } catch (err) {
              setError(formatRequestError(err));
              setBusy(null);
            }
          }}
        >
          Remove
        </button>
      </div>
      {draft.models.length > 0 && (
        <table className="settings-models">
          <thead>
            <tr>
              <th>Model</th>
              <th>Context window</th>
              <th>Reasoning</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.models.map((model) => (
              <tr key={model.id}>
                <td title={model.id}>{model.name || model.id}</td>
                <td>
                  <input
                    type="number"
                    min={1024}
                    step={1024}
                    value={model.contextWindow}
                    onChange={(event) => updateModel(model.id, { contextWindow: Math.max(1024, Number(event.target.value) || 1024) })}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={model.reasoning} onChange={(event) => updateModel(model.id, { reasoning: event.target.checked })} />
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary settings-inline-button"
                    onClick={() => setDraft((current) => ({ ...current, models: current.models.filter((item) => item.id !== model.id) }))}
                    aria-label={`Remove ${model.id}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error">{error}</p>}
      {notice && !error && <p className="muted">{notice}</p>}
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [storageBusy, setStorageBusy] = useState<'persist' | 'export' | 'wipe' | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const refreshStorage = useCallback(async () => {
    setUsage(await storageUsage());
    setPersisted(await isStoragePersisted());
  }, []);

  useEffect(() => {
    readSettings()
      .then(setSettings)
      .catch((error: unknown) => setLoadError(formatRequestError(error)));
    void refreshStorage();
  }, [refreshStorage]);

  const saveKey = async () => {
    const apiKey = keyDraft.trim();
    if (!apiKey || keyBusy) return;
    setKeyBusy(true);
    setKeyError(null);
    setKeySaved(false);
    try {
      setSettings(await setGeminiApiKey(apiKey, (key) => geminiProvider(() => key).validateKey(key)));
      setKeyDraft('');
      setKeySaved(true);
    } catch (error) {
      setKeyError(formatRequestError(error));
    } finally {
      setKeyBusy(false);
    }
  };

  const busy = keyBusy || storageBusy !== null;
  const defaultModel = settings ? resolveDefaultTextModel(settings) : null;
  const imageModel = settings?.imageDefaults.model ?? '';
  const capabilities = MODEL_CAPABILITIES[imageModel] ?? { aspectRatios: [], imageSizes: [] };

  return (
    <Modal title="Settings" onClose={() => !busy && onClose()} dialogClassName="settings-modal">
      <div className="settings-modal-body">
        {loadError && <p className="error error-banner">{loadError}</p>}
        {!settings && !loadError && <p className="muted">Loading…</p>}
        {settings && (
          <>
            <section className="settings-section">
              <h3>Text model (agent tasks)</h3>
              <p className="muted">
                Agent tasks run in your browser against an OpenAI-compatible endpoint you configure. Keys stay on this device and are sent only to that endpoint.
                Local servers (LM Studio, Ollama, llama.cpp) must allow this site's origin (CORS).
              </p>
              {settings.endpoints.map((endpoint) => (
                <EndpointEditor key={endpoint.id} endpoint={endpoint} onSaved={setSettings} onRemoved={setSettings} />
              ))}
              <div className="settings-actions">
                {ENDPOINT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="secondary"
                    title={preset.note}
                    onClick={async () => setSettings(await upsertEndpoint(newEndpoint(preset)))}
                  >
                    + {preset.name}
                  </button>
                ))}
                <button type="button" className="secondary" onClick={async () => setSettings(await upsertEndpoint({ ...newEndpoint(), baseUrl: 'http://localhost:8000/v1' }))}>
                  + Custom
                </button>
              </div>
              <div className="settings-grid">
                <label>
                  Default model
                  <select
                    value={settings.defaultTextModel ? `${settings.defaultTextModel.endpointId}::${settings.defaultTextModel.modelId}` : ''}
                    onChange={async (event) => {
                      const [endpointId, modelId] = event.target.value.split('::');
                      setSettings(await setDefaultTextModel(endpointId && modelId ? { endpointId, modelId } : null));
                    }}
                  >
                    <option value="">— choose a model —</option>
                    {settings.endpoints.flatMap((endpoint) =>
                      endpoint.models.map((model) => (
                        <option key={`${endpoint.id}::${model.id}`} value={`${endpoint.id}::${model.id}`}>
                          {endpoint.name}: {model.name || model.id} ({model.contextWindow.toLocaleString()} tokens)
                        </option>
                      )),
                    )}
                  </select>
                </label>
                <label>
                  Thinking level
                  <select value={settings.thinkingLevel} onChange={async (event) => setSettings(await setThinkingLevel(event.target.value as ThinkingLevel))}>
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {defaultModel ? (
                <p className="muted">
                  Book-reading tasks send the whole book with every task. Prepare the book from Story setup to check it fits in {defaultModel.model.contextWindow.toLocaleString()} tokens.
                </p>
              ) : (
                <p className="muted">No default model yet — agent tasks are disabled until you pick one.</p>
              )}
            </section>

            <section className="settings-section">
              <h3>Image generation (Gemini)</h3>
              <p className="muted">
                {geminiKeyConfigured(settings) ? 'A Google AI Studio key is configured.' : 'No Gemini API key configured — image generation is disabled.'}
              </p>
              <div className="settings-key-row">
                <input
                  type="password"
                  placeholder={geminiKeyConfigured(settings) ? 'Replace API key…' : 'Paste Google AI Studio API key…'}
                  value={keyDraft}
                  onChange={(event) => {
                    setKeyDraft(event.target.value);
                    setKeySaved(false);
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && saveKey()}
                />
                <button type="button" disabled={!keyDraft.trim() || keyBusy} onClick={saveKey}>
                  {keyBusy ? 'Validating…' : 'Save'}
                </button>
              </div>
              {keyError && <p className="error">{keyError}</p>}
              {keySaved && <p className="muted">Key validated and saved.</p>}
              <div className="settings-grid">
                <label>
                  Default image model
                  <select
                    value={imageModel}
                    onChange={async (event) => {
                      const model = event.target.value;
                      const caps = MODEL_CAPABILITIES[model];
                      const aspectRatio = caps?.aspectRatios.includes(settings.imageDefaults.aspectRatio) ? settings.imageDefaults.aspectRatio : caps?.aspectRatios[0] ?? '1:1';
                      const imageSize = caps?.imageSizes.includes(settings.imageDefaults.imageSize) ? settings.imageDefaults.imageSize : caps?.imageSizes[0] ?? '1K';
                      setSettings(await writeSettings({ imageDefaults: { model, aspectRatio, imageSize } }));
                    }}
                  >
                    {Object.keys(MODEL_CAPABILITIES).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Aspect ratio
                  <select
                    value={settings.imageDefaults.aspectRatio}
                    onChange={async (event) => setSettings(await writeSettings({ imageDefaults: { ...settings.imageDefaults, aspectRatio: event.target.value } }))}
                  >
                    {capabilities.aspectRatios.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Image size
                  <select
                    value={settings.imageDefaults.imageSize}
                    onChange={async (event) => setSettings(await writeSettings({ imageDefaults: { ...settings.imageDefaults, imageSize: event.target.value } }))}
                  >
                    {capabilities.imageSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-section">
              <h3>Storage</h3>
              <p className="muted">
                Projects live in this browser's storage on this device.
                {usage && ` Using ${formatBytes(usage.usage)}${usage.quota ? ` of ${formatBytes(usage.quota)}` : ''}.`}
                {persisted === true && ' Storage is persistent.'}
                {persisted === false && ' Storage is not yet marked persistent; the browser may evict it if space runs low.'}
              </p>
              <div className="settings-actions">
                {persisted === false && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={storageBusy !== null}
                    onClick={async () => {
                      setStorageBusy('persist');
                      await requestPersistentStorage();
                      await refreshStorage();
                      setStorageBusy(null);
                    }}
                  >
                    {storageBusy === 'persist' ? 'Requesting…' : 'Request persistent storage'}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={storageBusy !== null}
                  onClick={async () => {
                    setStorageBusy('export');
                    setStorageError(null);
                    try {
                      downloadBlob(await exportAllProjects(), 'comic-canvas-backup.zip');
                    } catch (error) {
                      setStorageError(formatRequestError(error));
                    } finally {
                      setStorageBusy(null);
                    }
                  }}
                >
                  {storageBusy === 'export' ? 'Exporting…' : 'Export all projects (zip)'}
                </button>
                <button type="button" className={clsx('secondary', 'settings-danger')} disabled={storageBusy !== null} onClick={() => setConfirmWipe(true)}>
                  Wipe all local data…
                </button>
              </div>
              {storageError && <p className="error">{storageError}</p>}
            </section>

            <section className="settings-section">
              <h3>About</h3>
              <p className="muted">Comic Canvas v{__APP_VERSION__}. Export a project from its landing card to back it up or move it to another browser.</p>
            </section>
          </>
        )}
      </div>
      {confirmWipe && (
        <ConfirmDialog
          title="Wipe all local data?"
          body="Every project, image, chat, and setting stored in this browser will be deleted. Export first if you want to keep anything."
          confirmLabel="Wipe everything"
          tone="danger"
          busy={storageBusy === 'wipe'}
          busyLabel="Wiping…"
          onCancel={() => setConfirmWipe(false)}
          onConfirm={async () => {
            setStorageBusy('wipe');
            try {
              await wipeAllLocalData();
              window.location.reload();
            } catch (error) {
              setStorageError(formatRequestError(error));
              setStorageBusy(null);
              setConfirmWipe(false);
            }
          }}
        />
      )}
    </Modal>
  );
}
