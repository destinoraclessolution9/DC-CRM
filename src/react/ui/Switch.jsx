import { forwardRef, useState, useId, useCallback } from 'react';

// Detect reduced-motion once at module load; cheap and avoids per-render matchMedia.
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Switch — accessible on/off toggle.
 *
 * Rendered as a real <button role="switch" aria-checked> styled into a track + thumb.
 * Native button gives us Space/Enter activation and focusability for free.
 *
 * Controlled:   pass `checked` + `onChange`.
 * Uncontrolled: pass `defaultChecked` (internal state); omit `checked`.
 *
 * onChange receives the next boolean value (not a DOM event) — switches have no
 * meaningful event target value, so the boolean is the useful payload.
 *
 * An adjacent `label` is optional but, when present, is wired to the control via
 * htmlFor/id so clicking the text toggles the switch and AT announces a name.
 * Without a visible label an `aria-label` is REQUIRED (the control is icon-like).
 */
export const Switch = forwardRef(function Switch(
  {
    label,
    checked,
    defaultChecked = false,
    onChange,
    disabled = false,
    id: idProp,
    'aria-label': ariaLabel,
    ...rest
  },
  ref
) {
  const generatedId = useId();
  const id = idProp || generatedId;

  // Controlled when `checked` is explicitly provided; otherwise track internally.
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isOn = isControlled ? checked : internalChecked;

  // Without a visible label we MUST have an aria-label, or the switch is unnamed.
  if (!label && !ariaLabel) {
    throw new Error('Switch requires a `label` or an `aria-label` for an accessible name.');
  }

  const handleToggle = useCallback(() => {
    if (disabled) return;
    const next = isControlled ? !checked : !internalChecked;
    if (!isControlled) setInternalChecked(next);
    onChange?.(next);
  }, [disabled, isControlled, checked, internalChecked, onChange]);

  // Track + thumb geometry kept local so the two stay in sync.
  const TRACK_W = 40;
  const TRACK_H = 24;
  const THUMB = 18;
  const PAD = (TRACK_H - THUMB) / 2;

  const transition = prefersReducedMotion
    ? 'none'
    : 'transform 160ms ease, background-color 160ms ease';

  const control = (
    <button
      ref={ref}
      type="button"
      role="switch"
      id={id}
      aria-checked={isOn}
      aria-label={!label ? ariaLabel : undefined}
      disabled={disabled}
      onClick={handleToggle}
      style={{
        // Reset native button chrome — we draw the track ourselves.
        appearance: 'none',
        border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border-strong)'}`,
        margin: 0,
        padding: 0,
        flex: '0 0 auto',
        position: 'relative',
        display: 'inline-block',
        width: TRACK_W,
        height: TRACK_H,
        borderRadius: TRACK_H,
        backgroundColor: isOn ? 'var(--accent)' : 'var(--bg-sunken)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        verticalAlign: 'middle',
        transition,
        outline: 'none',
        boxSizing: 'border-box',
      }}
      {...rest}
    >
      {/* Thumb — translateX between the two ends; aria-hidden, purely decorative. */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: PAD,
          width: THUMB,
          height: THUMB,
          borderRadius: '50%',
          backgroundColor: 'var(--text-inverse)',
          boxShadow: 'var(--shadow-sm)',
          transform: `translateY(-50%) translateX(${isOn ? TRACK_W - THUMB - PAD * 2 : 0}px)`,
          transition,
          pointerEvents: 'none',
        }}
      />
    </button>
  );

  if (!label) return control;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: 'var(--touch-target)',
      }}
    >
      {control}
      <label
        htmlFor={id}
        style={{
          color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          fontSize: '0.875rem',
        }}
      >
        {label}
      </label>
    </span>
  );
});
