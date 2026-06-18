import { forwardRef, useId } from 'react';

/**
 * Select — native <select> primitive sharing the TextField label/hint/error/aria
 * envelope. Reuses the global `.form-control` class so it visually matches every
 * other form control in the CRM.
 *
 * Controlled:   <Select value={v} onChange={fn} options={...} />
 * Uncontrolled: <Select defaultValue="a" options={...} />
 *
 * `placeholder` renders a leading disabled empty option (value=''), which doubles
 * as the "nothing selected" prompt for the uncontrolled/empty case.
 */
export const Select = forwardRef(function Select(
  {
    id,
    label,
    value,
    defaultValue,
    onChange,
    options = [],
    placeholder,
    hint,
    error,
    required,
    disabled,
    size = 'md',
    ...rest
  },
  ref
) {
  // Stable ids for label/hint/error association. useId keeps SSR + client in sync.
  const reactId = useId();
  const selectId = id || `select-${reactId}`;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;

  const hasError = Boolean(error);
  // Wire only the descriptors that actually render; error supersedes hint visually
  // but both can describe the control for assistive tech.
  const describedBy =
    [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  // Size tokens — md is the resting size; sm/lg nudge font + padding. The 44px
  // touch target floor (var(--touch-target)) guarantees comfortable tap area.
  const sizeStyle =
    size === 'sm'
      ? { fontSize: '0.8125rem', padding: '6px 10px' }
      : size === 'lg'
      ? { fontSize: '1.0625rem', padding: '12px 14px' }
      : { fontSize: '0.9375rem', padding: '9px 12px' };

  return (
    <div className="form-group">
      {label && (
        <label
          htmlFor={selectId}
          className="form-label"
          style={{
            display: 'block',
            marginBottom: 6,
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          {label}
          {required && (
            <span
              aria-hidden="true"
              style={{ color: 'var(--danger-text)', marginLeft: 4 }}
            >
              *
            </span>
          )}
        </label>
      )}

      <select
        ref={ref}
        id={selectId}
        className="form-control"
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        required={required}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        style={{
          minHeight: 'var(--touch-target)',
          width: '100%',
          ...sizeStyle,
          ...(hasError ? { borderColor: 'var(--danger)' } : null),
        }}
        {...rest}
      >
        {placeholder && (
          // Leading prompt: disabled so it can't be re-selected, empty value so an
          // unset uncontrolled select shows it without becoming a real choice.
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      {hint && !hasError && (
        <p
          id={hintId}
          style={{
            margin: '6px 0 0',
            fontSize: '0.8125rem',
            color: 'var(--text-muted)',
          }}
        >
          {hint}
        </p>
      )}

      {hasError && (
        <p
          id={errorId}
          role="alert"
          style={{
            margin: '6px 0 0',
            fontSize: '0.8125rem',
            color: 'var(--danger-text)',
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
});
