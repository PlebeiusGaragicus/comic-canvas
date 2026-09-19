export type ProjectPhase =
  | 'chat'
  | 'image-canvas'
  | 'story'
  | 'layout-editor'
  | 'concept-art'
  | 'characters-hub'
  | 'locations-hub';

export const workspaceNavItems: Array<{ id: ProjectPhase; label: string }> = [
  { id: 'story', label: 'Story' },
  { id: 'layout-editor', label: 'Layout' },
  { id: 'image-canvas', label: 'Canvas' },
  { id: 'concept-art', label: 'Concept Art' },
  { id: 'characters-hub', label: 'Characters' },
  { id: 'locations-hub', label: 'Locations' },
  { id: 'chat', label: 'Agent' },
];

export function projectPhaseLabel(phase: ProjectPhase) {
  return workspaceNavItems.find((item) => item.id === phase)?.label ?? phase;
}

export function projectPhaseHelp(phase: ProjectPhase) {
  switch (phase) {
    case 'chat':
      return 'Watch running Pi tasks live and browse every agent session and its trace.';
    case 'story':
      return 'Write panels one at a time, or upload book.txt to highlight passages into panel chunks. Use Reading to manage order and open Layout to place panels.';
    case 'concept-art':
      return 'Define visual styles and create concept cards to explore the look and feel before comic generation.';
    case 'characters-hub':
      return 'Review character cards, thumbnails, prompts, and generation/refinement actions.';
    case 'locations-hub':
      return 'Review location cards, thumbnails, prompts, and generation/refinement actions.';
    default:
      return undefined;
  }
}
