import { forwardRef, useId } from 'react';

/**
 * Textarea — multi-line text input sharing TextField's field envelope.
 *
 * Same label/hint/error/aria wiring as TextField, but forwards its ref to a
 * real <textarea className="form-control">. Supports controlled (value+onChange)
 * and uncontrolled (defaultValue) usage.
 *
 * a11y: label↔control wired via useId+htmlFor; hint/error linked through
 * aria-describedby; aria-invalid mirrors the error state.
 */
export const Textarea = forwardRef(function Textarea(
  {
    id,
    label,
    value,
    defaultValue,
    onChange,
    placeholder,
    hint,
    error,
    required = false,
    disabled = false,
    size = 'md',
    rows = 3,
    ...rest
  },
  ref
) {
  // Stable ids so the label, hint and error can be referenced by the control.
  const reactId = useId();
  const fieldId = id || reactId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const hasError = Boolean(error);

  // Only advertise describedby targets that are actually rendered. Error takes
  // precedence over the hint for screen readers when both could exist.
  const describedBy =
    [hasError ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  // Per the shared vocabulary, sizing is communicated to global CSS via a
  // data attribute rather than a hardcoded class so .form-control owns visuals.
  return (
    <div className="form-group">
      {label && (
        <label htmlFor={fieldId}>
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: 'var(--danger-text)', marginLeft: 2 }}>
              *
            </span>
          )}
        </label>
      )}

      <textarea
        ref={ref}
        id={fieldId}
        className="form-control"
        rows={rows || 3}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        data-size={size}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...rest}
      />

      {/* Error supersedes the hint when present; role=alert announces it. */}
      {hasError ? (
        <div id={errorId} role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.8125rem', marginTop: 4 }}>
          {error}
        </div>
      ) : (
        hint && (
          <div id={hintId} style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 4 }}>
            {hint}
          </div>
        )
      )}
    </div>
  );
});
