export function SidebarToggleIcon({ variant }: { variant: 'collapse' | 'expand' }) {
  return (
    <svg className="phase-sidebar-toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2.25" y="3.25" width="3.5" height="9.5" rx="1" fill="currentColor" opacity="0.35" stroke="none" />
      <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.25" />
      {variant === 'collapse' ? (
        <path d="M11 6 L8.5 8 L11 10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 6 L11.5 8 L9 10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function SidebarCollapseButton({
  onClick,
  className = '',
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`phase-sidebar-collapse ${className}`.trim()}
      onClick={onClick}
      title="Collapse sidebar"
      aria-label="Collapse sidebar"
    >
      <SidebarToggleIcon variant="collapse" />
    </button>
  );
}
