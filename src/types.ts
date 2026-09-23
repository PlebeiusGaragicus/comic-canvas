export type AssetKind = 'imported' | 'generated';

export interface Prompt {
  text: string;
}

export interface GenerationReceipt {
  refs: string[];
  runId: string;
  runIndex: number;
  model: string;
  aspectRatio: string;
  imageSize: string;
  seed?: number | null;
  chatSessionId?: string | null;
  chatTurnId?: string | null;
  visualStyleId?: string | null;
}

export interface ProviderCapture {
  name: string;
  response: Record<string, unknown>;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  title: string;
  tags: string[];
  contentHash?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  prompt?: Prompt | null;
  generation?: GenerationReceipt | null;
  provider?: ProviderCapture | null;
  hasPixels: boolean;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  isProtected?: boolean;
}

/** The persisted asset document (no derived fields). */
export type AssetMetadata = Omit<Asset, 'hasPixels' | 'thumbnailUrl' | 'imageUrl' | 'isProtected'>;

export interface Project {
  slug: string;
  name: string;
  createdAt: string;
  settings: Record<string, unknown>;
  coverAssetId?: string | null;
  coverThumbnailUrl?: string | null;
}

/** The persisted project document (no derived fields). */
export type ProjectMetadata = Omit<Project, 'coverThumbnailUrl'>;

export interface ProjectCreatePayload {
  slug: string;
  name: string;
  settings?: Record<string, unknown>;
}

export interface DisplayPatchPayload {
  title?: string | null;
  tags?: string[] | null;
}

export type EntityKind = 'character' | 'location' | 'style';

export interface TagDefinition {
  id: string;
  name: string;
  color: string;
  locked?: boolean;
  entityKind?: EntityKind | null;
  /** Entity tags only: the image that keeps this entity consistent across generations. */
  canonicalAssetId?: string | null;
}

export interface TagRegistryDocument {
  tags: TagDefinition[];
}

export interface ProjectDetail {
  project: Project;
  assets: Asset[];
  tags: TagDefinition[];
}

export interface CanvasDocument {
  version: 2;
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, CanvasNode>;
}

export interface GenerationParams {
  model?: string | null;
  aspectRatio?: string | null;
  imageSize?: string | null;
  seed?: number | null;
  batchCount: number;
}

export interface CanvasNodeLayout {
  displayName: string;
  x: number;
  y: number;
  width?: number | null;
  tags: string[];
}

export type ArtifactKind = 'character-sheet' | 'location-prompt' | 'concept-art';
export type ConceptArtSubjectKind = 'character' | 'location';

/** The one canvas node: an image made from a prompt. An empty `assetIds`
 *  stack is the draft state; `refs`/`prompt`/`params` are the recipe for the
 *  node's next generation. */
export interface CanvasNode extends CanvasNodeLayout {
  refs: string[];
  prompt: string;
  params: GenerationParams;
  visualStyleId?: string | null;
  assetIds: string[];
  activeAssetId?: string | null;
  origin?: CanvasNodeOrigin | null;
}

/** The domain object that spawned this node (results attach back to it). */
export interface CanvasNodeOrigin {
  kind: 'panel' | 'conceptCard';
  id: string;
}

export interface GeneratePayload {
  prompt: string;
  refs: string[];
  model?: string | null;
  aspectRatio?: string | null;
  imageSize?: string | null;
  seed?: number | null;
  batchCount: number;
  title?: string | null;
  tags: string[];
  canvasNodeId?: string | null;
  visualStyleId?: string | null;
}

export interface EntityVariant {
  label: string;
  /** When this look applies in the story, e.g. "after the duel in chapter 2". */
  storyContext: string;
  prompt: string;
  assetIds: string[];
  activeAssetId?: string | null;
}

export interface CharacterRecord {
  slug: string;
  name: string;
  summary: string;
  visualDescription: string;
  performanceNotes: string;
  continuityNotes: string;
  userTags: string[];
  variants: Record<string, EntityVariant>;
  createdAt: string;
  updatedAt: string;
}

export interface EntityVariantPatchPayload {
  label?: string;
  storyContext?: string;
  prompt?: string;
}

export interface CharacterPatchPayload {
  slug?: string;
  name?: string;
  summary?: string;
  visualDescription?: string;
  performanceNotes?: string;
  continuityNotes?: string;
  userTags?: string[];
  variants?: Record<string, EntityVariantPatchPayload>;
  removeVariants?: string[];
}

export interface LocationRecord {
  slug: string;
  name: string;
  summary: string;
  visualDescription: string;
  continuityNotes: string;
  userTags: string[];
  variants: Record<string, EntityVariant>;
  createdAt: string;
  updatedAt: string;
}

export interface LocationPatchPayload {
  slug?: string;
  name?: string;
  summary?: string;
  visualDescription?: string;
  continuityNotes?: string;
  userTags?: string[];
  variants?: Record<string, EntityVariantPatchPayload>;
  removeVariants?: string[];
}

/** Result of preparing the book for agent tasks (replaces the pi read-book session). */
export interface BookContext {
  bookHash: string;
  tokenEstimate: number;
  preparedAt: string;
  fits: boolean;
  modelId: string | null;
  contextWindow: number | null;
}

export interface AdaptationMetadata {
  version: 4;
  characters: Record<string, CharacterRecord>;
  locations: Record<string, LocationRecord>;
  bookContext?: BookContext | null;
}

export interface CharacterCreatePayload {
  name: string;
  summary?: string;
  slug?: string;
}

export type LocationCreatePayload = CharacterCreatePayload;

export interface VisualStyleCreatePayload {
  name: string;
  prompt?: string | null;
}

export interface VisualStylePatchPayload {
  name?: string;
  prompt?: string;
  default?: boolean;
}

export interface VisualStyleDefinition {
  id: string;
  name: string;
  prompt: string;
  default?: boolean;
}

export interface AdaptationStatus {
  projectSlug: string;
  hasBook: boolean;
  hasBookSession: boolean;
  counts: Record<string, number>;
  visualStyles: VisualStyleDefinition[];
  defaultVisualStyleId?: string | null;
  characters: Record<string, CharacterRecord>;
  locations: Record<string, LocationRecord>;
}

export interface StoryPanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoryPanelPage {
  id: string;
  order: number;
  title: string;
  pageKind: 'cover' | 'inside-cover' | 'story' | 'inside-back-cover' | 'back-cover';
}

export interface StoryPanelPageSettings {
  width: number;
  height: number;
}

export interface StoryPanelImageCrop {
  focalX: number;
  focalY: number;
  scale: number;
}

export interface StoryPanelTextStyle {
  fontFamily: 'serif' | 'sans' | 'mono' | 'comic';
  fontSize: number;
  align: 'left' | 'center' | 'right';
  speechKind?: 'dialogue' | 'narration';
  background?: 'transparent' | 'white';
  color?: string;
  outlineColor?: string;
}

/** Tip of a dialogue bubble's tail, in page-grid coordinates (24-column space on spanning parents). */
export interface StoryPanelCaptionTail {
  x: number;
  y: number;
}

export interface StoryPanelCaption {
  id: string;
  visibleText: string;
  richText: string;
  textStyle: StoryPanelTextStyle;
  rect: StoryPanelRect;
  tail?: StoryPanelCaptionTail | null;
  layer: number;
}

export interface StoryPanelImagePrompt {
  id: string;
  text: string;
}

/** Camera framing decided when the passage was chunked into panels. */
export type StoryPanelShot = 'establishing' | 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'insert' | 'two-shot';
/** Relative page weight the panel wants; consumed by layout, not by placement math yet. */
export type StoryPanelSizeHint = 'small' | 'medium' | 'large' | 'splash' | 'spread';

export interface StoryPanel {
  id: string;
  order: number;
  title: string;
  sourceKind: 'panel' | 'bookmark';
  startOffset: number | null;
  endOffset: number | null;
  selectedText: string;
  storyText: string;
  visibleText: string;
  richText: string;
  textStyle: StoryPanelTextStyle;
  pageId: string | null;
  panelKind: 'image' | 'text';
  /** Panel spans its two-page spread: rect uses a unified 24-column space anchored on the left page. */
  spansSpread?: boolean;
  rect: StoryPanelRect;
  /** Dialogue-bubble tail tip; only meaningful on caption items (parentPanelId set). */
  tail?: StoryPanelCaptionTail | null;
  layer: number;
  parentPanelId?: string | null;
  assetIds: string[];
  activeAssetId?: string | null;
  aspectRatio?: string | null;
  aspectRatioLocked?: boolean;
  imageCrop?: StoryPanelImageCrop | null;
  captions: StoryPanelCaption[];
  imagePrompts: StoryPanelImagePrompt[];
  characterSlugs: string[];
  locationSlug?: string | null;
  shot: StoryPanelShot | null;
  sizeHint: StoryPanelSizeHint | null;
  finalized: boolean;
}

export interface StoryPanelDocument {
  version: 1;
  bookSource: string;
  pageSettings: StoryPanelPageSettings;
  pages: StoryPanelPage[];
  panels: StoryPanel[];
}

export interface StoryPanelCreatePayload {
  startOffset?: number | null;
  endOffset?: number | null;
  selectedText?: string;
  title?: string;
  storyText?: string;
  visibleText?: string;
  imagePrompts?: StoryPanelImagePrompt[];
  insertAfterPanelId?: string | null;
  autoPlace?: boolean;
  pageId?: string | null;
  panelKind?: 'image' | 'text';
  rect?: StoryPanelRect | null;
  layer?: number;
  shot?: StoryPanelShot | null;
  sizeHint?: StoryPanelSizeHint | null;
  characterSlugs?: string[];
  locationSlug?: string | null;
}

export interface StoryPanelBookmarkCreatePayload {
  startOffset: number;
  endOffset: number;
  selectedText?: string;
  title?: string;
  insertAfterPanelId?: string | null;
}

export type StoryPanelPatchPayload = Partial<
  Pick<StoryPanel, 'order' | 'title' | 'sourceKind' | 'startOffset' | 'endOffset' | 'selectedText' | 'storyText' | 'visibleText' | 'richText' | 'textStyle' | 'pageId' | 'panelKind' | 'spansSpread' | 'rect' | 'layer' | 'parentPanelId' | 'assetIds' | 'activeAssetId' | 'aspectRatio' | 'aspectRatioLocked' | 'imageCrop' | 'captions' | 'imagePrompts' | 'characterSlugs' | 'locationSlug' | 'shot' | 'sizeHint' | 'finalized'>
>;

export interface AdaptationCanvasImportResponse {
  canvas: CanvasDocument;
  importedNodeCount: number;
  nodeId?: string | null;
}

export interface ImageGroupNodeResponse {
  nodeId: string;
  canvas: CanvasDocument;
}

export interface ConceptNodeResponse {
  nodeId: string;
  canvas: CanvasDocument;
}

export interface ChatTurnSettings {
  model: string;
  aspectRatio: string;
  imageSize: string;
  thinkingLevel?: string | null;
  includeThoughts: boolean;
}

export interface ChatAttachment {
  kind: 'asset';
  assetId: string;
  purpose: 'source' | 'reference';
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  createdAt: string;
  text: string;
  settings: ChatTurnSettings;
  attachments: ChatAttachment[];
  generatedAssetIds: string[];
}

export interface ChatProviderState {
  name: 'google-genai';
  model: string;
  /** Raw Gemini `Content` objects; image parts carry `inlineData.dataRef` blob paths on disk. */
  history: Array<Record<string, unknown>>;
}

export interface ChatSession {
  version: 1;
  id: string;
  projectSlug: string;
  status: 'active' | 'archived';
  title: string;
  source: { assetId: string; canvasNodeId?: string | null };
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  defaults: ChatTurnSettings;
  protectedAssetIds: string[];
  turns: ChatTurn[];
  provider: ChatProviderState;
}

export interface CreateChatSessionPayload {
  sourceAssetId: string;
  canvasNodeId?: string | null;
  title?: string | null;
}

export interface ChatTurnPayload {
  text: string;
  attachmentAssetIds: string[];
  settings?: ChatTurnSettings | null;
}

export interface ChatTurnResponse {
  session: ChatSession;
  assets: Asset[];
}

export interface ConceptCardCreatePayload {
  subjectKind: ConceptArtSubjectKind;
  prompt?: string | null;
  displayName?: string;
}

export interface ConceptCardPatchPayload {
  displayName?: string;
  prompt?: string;
  subjectKind?: ConceptArtSubjectKind;
  archived?: boolean | null;
}

export interface ImageGroupNodeCreatePayload {
  displayName?: string;
  tags?: string[];
  prompt?: string;
  refs?: string[];
  visualStyleId?: string | null;
}

export interface StoryPanelImagePromptWrite {
  text: string;
  characterSlugs?: string[] | null;
  locationSlug?: string | null;
}

export interface ConceptCard {
  version: 1;
  id: string;
  projectSlug: string;
  subjectKind: ConceptArtSubjectKind;
  displayName: string;
  prompt: string;
  assetIds: string[];
  activeAssetId?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export type AgentSessionKind =
  | 'read-book'
  | 'discover-characters'
  | 'extract-character'
  | 'extract-all-characters'
  | 'refine-character'
  | 'discover-locations'
  | 'extract-location'
  | 'extract-all-locations'
  | 'refine-location'
  | 'suggest-concept-character'
  | 'suggest-concept-location'
  | 'draft-panel-prompt'
  | 'refine-panel-prompt'
  | 'chunk-panels';

export type PiTaskProfile =
  | 'read-book'
  | 'discover-characters'
  | 'extract-character'
  | 'extract-all-characters'
  | 'refine-character'
  | 'discover-locations'
  | 'extract-location'
  | 'extract-all-locations'
  | 'refine-location'
  | 'suggest-concept-character'
  | 'suggest-concept-location'
  | 'draft-panel-prompt'
  | 'refine-panel-prompt'
  | 'chunk-panels';

export type PiTaskState = 'starting' | 'running' | 'aborting' | 'done' | 'failed' | 'cancelled';

export interface PiTaskStatus {
  taskId: string;
  projectSlug: string;
  profile: string;
  title: string;
  target?: string | null;
  state: PiTaskState;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  /** Token estimate of the seeded book context, when the task carries the book. */
  bookTokenEstimate?: number | null;
}

export interface PiTaskEvent {
  seq: number;
  ts: string;
  event: {
    type: string;
    [key: string]: unknown;
  };
}

export type AgentSessionStatus = 'running' | 'succeeded' | 'failed' | 'archived';

export interface AgentSession {
  version: 1;
  id: string;
  projectSlug: string;
  title: string;
  kind: AgentSessionKind;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  archivedAt?: string | null;
  parentSessionId?: string | null;
  source: Record<string, unknown>;
  error?: string | null;
  stats?: Record<string, unknown> | null;
  /** Key of the stored agent trace (equals the task id). */
  traceId?: string | null;
  /** @deprecated pi subprocess era; removed from the UI in the agent-runtime phase. */
  piSessionId?: string | null;
  /** @deprecated pi subprocess era; removed from the UI in the agent-runtime phase. */
  piSessionFile?: string | null;
}

export interface AgentSessionPatchPayload {
  title?: string | null;
  archived?: boolean | null;
}

export interface AgentTraceStep {
  name: string;
  model: string | null;
  /** pi-agent-core AgentMessage[] for the step, stored verbatim. */
  messages: unknown[];
  /** Leading messages that were seeded by the app (book context), not typed by the user. */
  seededMessages?: number;
  /** Token estimate of the seeded context, when known. */
  seededTokenEstimate?: number | null;
}

export interface AgentTraceDocument {
  version: 1;
  taskId: string;
  projectSlug: string;
  steps: AgentTraceStep[];
}

export interface PiTraceUsage {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  totalTokens?: number | null;
}

export interface PiTraceUserStep {
  kind: 'user';
  timestamp?: string | null;
  text: string;
}

export interface PiTraceToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string | null;
  isError?: boolean;
  details?: { diff?: string; firstChangedLine?: number } | null;
}

export interface PiTraceAssistantStep {
  kind: 'assistant';
  timestamp?: string | null;
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  stopReason?: string | null;
  usage?: PiTraceUsage | null;
  thinking: string[];
  text?: string | null;
  toolCalls: PiTraceToolCall[];
}

export interface PiTraceInfoBanner {
  kind: 'compaction' | 'branch_summary' | 'seed' | 'step';
  timestamp?: string | null;
  text: string;
  tokensBefore?: number | null;
}

export type PiTraceStep = PiTraceUserStep | PiTraceAssistantStep | PiTraceInfoBanner;

export interface PiTraceStats {
  messageCount: number;
  toolCount: number;
  userCount: number;
  assistantCount: number;
}

export interface PiTraceDocument {
  sessionId?: string | null;
  version?: number | null;
  steps: PiTraceStep[];
  stats: PiTraceStats;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Model-specific thinking wire values keyed by pi thinking level; `null` marks unsupported. */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export interface TextModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap | null;
  contextWindow: number;
  maxTokens?: number | null;
  /** pi-ai `OpenAICompletionsCompat` overrides, passed through verbatim. */
  compat?: Record<string, unknown> | null;
}

/** A user-configured OpenAI-completions compatible endpoint (BYOK). */
export interface TextEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: TextModelDef[];
}

export interface DefaultTextModel {
  endpointId: string;
  modelId: string;
}

export interface ImageDefaults {
  model: string;
  aspectRatio: string;
  imageSize: string;
}

export interface AppSettings {
  version: 1;
  endpoints: TextEndpoint[];
  defaultTextModel: DefaultTextModel | null;
  thinkingLevel: ThinkingLevel;
  geminiApiKey: string;
  imageDefaults: ImageDefaults;
  storageMode: 'opfs';
  uiPrefs: Record<string, unknown>;
}

/** @deprecated Backend settings probe; SettingsModal is rewritten in the UI-cutover phase. */
export interface SettingsCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string | null;
}

/** @deprecated Backend settings probe; SettingsModal is rewritten in the UI-cutover phase. */
export interface SettingsInfo {
  appVersion: string;
  libraryVersion: string | null;
  homePath: string;
  geminiKeyConfigured: boolean;
  checks: SettingsCheck[];
}

export interface TrashEntry {
  kind: 'asset' | 'project';
  id: string;
  deletedAt: string;
  /** The deleted document (asset metadata or project metadata). */
  doc: unknown;
  /** OPFS paths (files or one directory) to remove on empty-trash. */
  blobPaths: string[];
}
