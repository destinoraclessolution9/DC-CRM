import { useCallback } from 'react';

// Map a status tone to its AA-contrast foreground token + a translucent/soft bg.
// Foreground MUST use the --*-text pairs (never raw --danger/--warning) so text
// passes WCAG AA. Neutral falls back to --text-secondary on the sunken surface.
const TONE_STYLES = {
  neutral: { color: 'var(--text-secondary)', background: 'var(--bg-sunken)' },
  info: { color: 'var(--info-text)', background: 'color-mix(in srgb, var(--info) 14%, transparent)' },
  success: { color: 'var(--success-text)', background: 'color-mix(in srgb, var(--success) 14%, transparent)' },
  warning: { color: 'var(--warning-text)', background: 'color-mix(in srgb, var(--warning) 14%, transparent)' },
  danger: { color: 'var(--danger-text)', background: 'color-mix(in srgb, var(--danger) 14%, transparent)' },
};

/**
 * Badge — inline status pill.
 * tone => foreground via the AA --*-text token + a translucent token bg.
 * removable => trailing × button (aria-label="Remove") that calls onRemove.
 */
export function Badge({ tone = 'neutral', children, removable = false, onRemove }) {
  const palette = TONE_STYLES[tone] || TONE_STYLES.neutral;

  const handleRemove = useCallback(
    (e) => {
      // Don't let the click bubble to an enclosing row/card handler.
      e.stopPropagation();
      onRemove?.(e);
    },
    [onRemove],
  );

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: 1.4,
        color: palette.color,
        background: palette.background,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      {removable && (
        <button
          type="button"
          aria-label="Remove"
          onClick={handleRemove}
          style={{
            // Inherit the pill's tone color so the × stays AA-legible.
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            margin: 0,
            width: '14px',
            height: '14px',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: '13px',
            lineHeight: 1,
            cursor: 'pointer',
            borderRadius: '999px',
          }}
        >
          {/* Glyph is decorative; the accessible name comes from aria-label. */}
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
