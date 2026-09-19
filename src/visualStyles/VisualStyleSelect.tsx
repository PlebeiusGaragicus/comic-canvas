import { useEffect } from 'react';
import { resolveVisualStyleId } from './visualStyleUtils';
import type { VisualStyleDefinition } from '../types';

export function VisualStyleSelect({
  styles,
  value,
  defaultStyleId,
  onChange,
  disabled = false,
}: {
  styles: VisualStyleDefinition[];
  value: string | null | undefined;
  defaultStyleId?: string | null;
  onChange: (styleId: string | null) => void;
  disabled?: boolean;
}) {
  const resolved = resolveVisualStyleId(value, styles, defaultStyleId);
  const missingLabel =
    value && !styles.some((style) => style.id === value) ? `Missing style (${value})` : null;

  useEffect(() => {
    if (!value && resolved && resolved !== value) {
      onChange(resolved);
    }
  }, [value, resolved, onChange]);

  return (
    <label className="field-label">
      Visual style
      <select
        value={resolved ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">None</option>
        {missingLabel && value && <option value={value}>{missingLabel}</option>}
        {styles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}
            {style.default ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
