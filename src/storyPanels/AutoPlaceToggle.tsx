export function AutoPlaceToggle({
  enabled,
  onChange,
  className = '',
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`project-top-bar-toggle story-auto-place-toggle ${enabled ? 'is-active' : ''} ${className}`.trim()}
      aria-pressed={enabled}
      title={enabled ? 'New panels are placed on the layout automatically' : 'New panels stay unplaced until you place them in Layout'}
      onClick={() => onChange(!enabled)}
    >
      Auto place
    </button>
  );
}
