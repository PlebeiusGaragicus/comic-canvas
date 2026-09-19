export function PanelChunksToggleIcon({ variant }: { variant: 'collapse' | 'expand' }) {
  return (
    <svg className="story-panels-chunks-toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" stroke="currentColor" strokeWidth="1.25" />
      {variant === 'collapse' ? (
        <path d="M9 8 L6 5.5 M9 8 L6 10.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M5 8 L8 5.5 M5 8 L8 10.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function PanelChunksToggleButton({
  variant,
  onClick,
  className = '',
}: {
  variant: 'collapse' | 'expand';
  onClick: () => void;
  className?: string;
}) {
  const isCollapse = variant === 'collapse';
  return (
    <button
      type="button"
      className={`project-top-bar-toggle ${isCollapse ? 'is-icon-only' : ''} ${className}`.trim()}
      onClick={onClick}
      title={isCollapse ? 'Hide panels' : 'Show panels'}
      aria-label={isCollapse ? 'Hide panels' : 'Show panels'}
    >
      <PanelChunksToggleIcon variant={variant} />
      {!isCollapse && <span>Panels</span>}
    </button>
  );
}
