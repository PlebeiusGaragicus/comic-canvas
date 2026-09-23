/** The app's service facade. Same method names and return shapes as the old
 *  HTTP client so views change as little as possible; every call runs
 *  against the local IndexedDB/OPFS store. */
import type {
  AdaptationCanvasImportResponse,
  AdaptationStatus,
  AgentSession,
  Asset,
  CanvasDocument,
  CharacterPatchPayload,
  CharacterRecord,
  ChatSession,
  ChatTurnPayload,
  ChatTurnResponse,
  ConceptArtSubjectKind,
  ConceptCard,
  ConceptNodeResponse,
  CreateChatSessionPayload,
  GeneratePayload,
  ImageGroupNodeResponse,
  LocationPatchPayload,
  LocationRecord,
  PiTaskProfile,
  PiTaskStatus,
  PiTraceDocument,
  Project,
  ProjectDetail,
  StoryPanelBookmarkCreatePayload,
  StoryPanelCreatePayload,
  StoryPanelDocument,
  StoryPanelPatchPayload,
  TagDefinition,
  TagRegistryDocument,
  VisualStyleDefinition,
} from './types';
import * as projects from './services/projects';
import * as assets from './services/assets';
import * as tags from './services/tags';
import * as canvas from './services/canvas';
import * as canvasNodes from './services/canvasNodes';
import * as trash from './services/trash';
import * as generation from './services/generation';
import * as adaptation from './services/adaptation';
import * as visualStyles from './services/visualStyles';
import * as conceptCards from './services/conceptCards';
import * as agentSessions from './services/agentSessions';
import * as chatSessions from './services/chatSessions';
import * as storyPanels from './services/storyPanels';
import * as print from './services/print';
import { readSettings } from './services/settings';
import { geminiProvider } from './providers/gemini';
import { taskManager } from './agent/runtime';
import { taskArgs } from './agent/profiles/types';
import { projectTrace } from './agent/trace';
import { notFound } from './services/errors';

const DEBUG = import.meta.env.DEV;

function debugLog(message: string, details?: unknown) {
  if (!DEBUG) return;
  if (details === undefined) console.debug(`[comic-canvas] ${message}`);
  else console.debug(`[comic-canvas] ${message}`, details);
}

/** Image provider bound to the key in settings at call time. */
const imageProvider = geminiProvider(() => settingsCache?.geminiApiKey ?? null);
let settingsCache: { geminiApiKey: string } | null = null;
async function withGeminiKey<T>(run: () => Promise<T>): Promise<T> {
  settingsCache = await readSettings();
  return run();
}

export const api = {
  listProjects: (): Promise<Project[]> => projects.listProjects(),
  createProject: (slug: string, name: string, settings: Record<string, unknown> = {}): Promise<Project> =>
    projects.createProject({ slug, name, settings }),
  getProject: (slug: string, includeArchived = false): Promise<ProjectDetail> => projects.getProjectDetail(slug, includeArchived),
  getProjectTags: (slug: string): Promise<TagDefinition[]> => tags.listProjectTags(slug),
  saveProjectTags: async (slug: string, tagList: TagDefinition[]): Promise<TagRegistryDocument> => {
    await tags.writeTagRegistry(slug, { tags: tagList });
    return tags.readTagRegistry(slug);
  },
  setProjectCover: (slug: string, coverAssetId: string | null): Promise<Project> => projects.patchProjectCover(slug, coverAssetId),
  deleteProject: (slug: string): Promise<void> => trash.deleteProject(slug),
  getCanvas: (slug: string, includeArchived = false): Promise<CanvasDocument> => canvas.readCanvas(slug, includeArchived),
  saveCanvas: (slug: string, document: CanvasDocument): Promise<CanvasDocument> => canvas.writeCanvas(slug, document),
  generate: (slug: string, payload: GeneratePayload): Promise<{ assets: Asset[] }> => {
    debugLog('generate', { slug, canvasNodeId: payload.canvasNodeId, batchCount: payload.batchCount });
    return withGeminiKey(() => generation.createGeneratedAssets(slug, payload, imageProvider));
  },
  getAdaptation: (slug: string): Promise<AdaptationStatus> => adaptation.status(slug),
  createVisualStyle: (slug: string, payload: { name: string; prompt?: string }): Promise<AdaptationStatus> =>
    visualStyles.createVisualStyle(slug, payload),
  updateVisualStyle: (slug: string, styleId: string, payload: { name?: string; prompt?: string; default?: boolean }): Promise<AdaptationStatus> =>
    visualStyles.updateVisualStyle(slug, styleId, payload),
  deleteVisualStyle: (slug: string, styleId: string): Promise<AdaptationStatus> => visualStyles.deleteVisualStyle(slug, styleId),
  listConceptCards: (slug: string, includeArchived = false): Promise<ConceptCard[]> => conceptCards.listCards(slug, includeArchived),
  createConceptCard: (slug: string, payload: { subjectKind: ConceptArtSubjectKind; prompt?: string; displayName?: string }): Promise<ConceptCard> =>
    conceptCards.createCard(slug, payload),
  updateConceptCard: (
    slug: string,
    cardId: string,
    payload: { displayName?: string; prompt?: string; subjectKind?: ConceptArtSubjectKind; archived?: boolean | null },
  ): Promise<ConceptCard> => conceptCards.updateCard(slug, cardId, payload),
  deleteConceptCard: (slug: string, cardId: string): Promise<void> => conceptCards.deleteCard(slug, cardId),
  draftConceptCard: (slug: string, cardId: string): Promise<ConceptNodeResponse> => conceptCards.draftCardToCanvas(slug, cardId),
  createImageGroup: (
    slug: string,
    payload: { displayName?: string; tags?: string[]; prompt?: string; refs?: string[]; visualStyleId?: string | null },
  ): Promise<ImageGroupNodeResponse> => canvasNodes.createImageGroup(slug, payload),
  uploadConceptCardImage: (slug: string, cardId: string, file: File): Promise<ConceptCard> => conceptCards.uploadCardImage(slug, cardId, file),
  listCharacters: (slug: string): Promise<CharacterRecord[]> => adaptation.listCharacters(slug),
  createCharacter: (slug: string, payload: { name: string; summary?: string; slug?: string }): Promise<CharacterRecord> =>
    adaptation.createCharacter(slug, payload),
  patchCharacter: (slug: string, characterSlug: string, payload: CharacterPatchPayload): Promise<CharacterRecord> =>
    adaptation.updateCharacter(slug, characterSlug, payload),
  deleteCharacter: (slug: string, characterSlug: string): Promise<AdaptationStatus> => adaptation.deleteCharacter(slug, characterSlug),
  draftCharacterVariant: (slug: string, characterSlug: string, variantKey: string): Promise<AdaptationCanvasImportResponse> =>
    adaptation.draftCharacterVariantToCanvas(slug, characterSlug, variantKey),
  resetCharacterData: (slug: string): Promise<AdaptationStatus> => adaptation.resetCharacterData(slug),
  listLocations: (slug: string): Promise<LocationRecord[]> => adaptation.listLocations(slug),
  createLocation: (slug: string, payload: { name: string; summary?: string; slug?: string }): Promise<LocationRecord> =>
    adaptation.createLocation(slug, payload),
  patchLocation: (slug: string, locationSlug: string, payload: LocationPatchPayload): Promise<LocationRecord> =>
    adaptation.updateLocation(slug, locationSlug, payload),
  deleteLocation: (slug: string, locationSlug: string): Promise<AdaptationStatus> => adaptation.deleteLocation(slug, locationSlug),
  draftLocationVariant: (slug: string, locationSlug: string, variantKey: string): Promise<AdaptationCanvasImportResponse> =>
    adaptation.draftLocationVariantToCanvas(slug, locationSlug, variantKey),
  startPiTask: (slug: string, profile: PiTaskProfile, options: { target?: string; force?: boolean; instructions?: string } = {}): Promise<PiTaskStatus> =>
    taskManager.startTask(slug, profile, taskArgs(options)),
  listPiTasks: (slug: string, params: { profile?: string; active?: boolean } = {}): Promise<PiTaskStatus[]> => taskManager.listStatuses(slug, params),
  getPiTask: async (slug: string, taskId: string): Promise<PiTaskStatus> => {
    const status = taskManager.getStatus(slug, taskId);
    if (!status) throw notFound(`Pi task not found: ${taskId}`);
    return status;
  },
  abortPiTask: async (slug: string, taskId: string): Promise<{ cancelled: boolean }> => ({ cancelled: taskManager.abort(slug, taskId) }),
  listAgentSessions: (slug: string, includeArchived = false): Promise<AgentSession[]> => agentSessions.listSessions(slug, includeArchived),
  getAgentSession: (slug: string, sessionId: string): Promise<AgentSession> => agentSessions.readSession(slug, sessionId),
  patchAgentSession: (slug: string, sessionId: string, payload: { title?: string | null; archived?: boolean | null }): Promise<AgentSession> =>
    agentSessions.patchSession(slug, sessionId, payload),
  getAgentSessionTrace: async (slug: string, sessionId: string): Promise<PiTraceDocument> => {
    const session = await agentSessions.readSession(slug, sessionId);
    return projectTrace(session.traceId ? await agentSessions.readTraceDocument(slug, session.traceId) : null);
  },
  getStoryPanelBook: async (slug: string): Promise<{ text: string }> => ({ text: (await adaptation.optionalBookText(slug)) ?? '' }),
  getStoryPanels: (slug: string): Promise<StoryPanelDocument> => storyPanels.readDocument(slug),
  getStoryPanelsBookletPdf: (slug: string, options?: { pageBorder?: 'black' | 'grey' | 'none' }): Promise<Blob> =>
    print.renderBookletPdf(slug, { pageBorder: options?.pageBorder ?? 'black' }),
  saveStoryPanels: (slug: string, document: StoryPanelDocument): Promise<StoryPanelDocument> => storyPanels.saveDocument(slug, document),
  createStoryPanel: (slug: string, payload: StoryPanelCreatePayload): Promise<StoryPanelDocument> => storyPanels.createPanel(slug, payload),
  createStoryBookmark: (slug: string, payload: StoryPanelBookmarkCreatePayload): Promise<StoryPanelDocument> => storyPanels.createBookmark(slug, payload),
  patchStoryPanel: (slug: string, panelId: string, patch: StoryPanelPatchPayload): Promise<StoryPanelDocument> => storyPanels.patchPanel(slug, panelId, patch),
  draftPanelToCanvas: (slug: string, panelId: string, promptId: string): Promise<ConceptNodeResponse> => storyPanels.draftPanelToCanvas(slug, panelId, promptId),
  autoPlaceStoryPanel: (slug: string, panelId: string): Promise<StoryPanelDocument> => storyPanels.autoPlacePanel(slug, panelId),
  deleteStoryPanel: (slug: string, panelId: string): Promise<StoryPanelDocument> => storyPanels.deletePanel(slug, panelId),
  // Recovery after breaking panels schema changes; keeps canvas, assets, and adaptation.
  resetStoryPanelLayout: (slug: string): Promise<StoryPanelDocument> => storyPanels.resetLayout(slug),
  resetStoryPanelChunks: (slug: string): Promise<StoryPanelDocument> => storyPanels.resetChunks(slug),
  importAdaptationBook: (slug: string, file: File): Promise<AdaptationStatus> => adaptation.importBook(slug, file),
  setTagCanonical: (slug: string, tagId: string, assetId: string | null): Promise<TagDefinition[]> => tags.setTagCanonical(slug, tagId, assetId),
  patchDisplay: (slug: string, assetId: string, title: string, tagList: string[]): Promise<Asset> =>
    assets.patchDisplay(slug, assetId, { title, tags: tagList }),
  archiveAsset: (slug: string, assetId: string, archived = true): Promise<Asset> => assets.patchArchive(slug, assetId, archived),
  deleteAsset: (slug: string, assetId: string): Promise<void> => trash.deleteAsset(slug, assetId),
  listChatSessions: (slug: string, includeArchived = false): Promise<ChatSession[]> => chatSessions.listSessions(slug, includeArchived),
  createChatSession: (slug: string, payload: CreateChatSessionPayload): Promise<ChatSession> => chatSessions.createSession(slug, payload),
  patchChatSession: (slug: string, sessionId: string, payload: { title?: string | null; archived?: boolean | null }): Promise<ChatSession> =>
    chatSessions.patchSession(slug, sessionId, payload),
  sendChatTurn: (slug: string, sessionId: string, payload: ChatTurnPayload): Promise<ChatTurnResponse> =>
    withGeminiKey(() => chatSessions.appendTurn(slug, sessionId, payload, imageProvider)),
  importAsset: (slug: string, file: File, position?: { x: number; y: number }): Promise<Asset> =>
    assets.importAsset(slug, file, {
      title: file.name.replace(/\.[^.]+$/, ''),
      canvasX: position?.x,
      canvasY: position?.y,
    }),
};

export type { VisualStyleDefinition };
