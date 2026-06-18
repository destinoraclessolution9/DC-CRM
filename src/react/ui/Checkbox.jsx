import { forwardRef, useId, useRef, useEffect, useImperativeHandle } from 'react';

/**
 * Checkbox — accessible checkbox with optional indeterminate state.
 *
 * Controlled (checked + onChange) OR uncontrolled (defaultChecked).
 * `indeterminate` is a DOM-only property, so it's applied via a ref effect.
 * The whole label row is the 44px touch target (label wraps the control).
 */
export const Checkbox = forwardRef(function Checkbox(
  {
    label,
    checked,
    defaultChecked,
    onChange,
    indeterminate,
    disabled = false,
    ...rest
  },
  ref
) {
  const id = useId();
  const inputRef = useRef(null);

  // Expose the real <input> node to the parent while keeping a local ref.
  useImperativeHandle(ref, () => inputRef.current, []);

  // `indeterminate` has no HTML attribute — it must be set imperatively.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !!indeterminate;
    }
  }, [indeterminate]);

  // Only pass `checked` (controlled) when explicitly provided; otherwise let
  // `defaultChecked` drive the uncontrolled case — never both.
  const controlled = checked !== undefined;

  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-sm, 8px)',
        minHeight: 'var(--touch-target)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        userSelect: 'none',
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        disabled={disabled}
        onChange={onChange}
        {...(controlled
          ? { checked }
          : defaultChecked !== undefined
          ? { defaultChecked }
          : {})}
        style={{
          width: '18px',
          height: '18px',
          flexShrink: 0,
          accentColor: 'var(--accent)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        {...rest}
      />
      {label != null && <span>{label}</span>}
    </label>
  );
});
