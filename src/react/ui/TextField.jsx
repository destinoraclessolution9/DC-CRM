import { forwardRef, useId } from 'react';

/**
 * TextField — labelled <input> field envelope.
 *
 * Controlled (value + onChange) or uncontrolled (defaultValue).
 * Wires label↔input via useId/htmlFor and hint/error via aria-describedby.
 * startSlot/endSlot render inside a flex-aligned wrapper around the input.
 */
export const TextField = forwardRef(function TextField(
  {
    id: idProp,
    label,
    value,
    defaultValue,
    onChange,
    type = 'text',
    placeholder,
    hint,
    error,
    required,
    disabled,
    size = 'md',
    startSlot,
    endSlot,
    ...rest
  },
  ref
) {
  // Stable ids; only the parts we actually render get referenced.
  const autoId = useId();
  const id = idProp || autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  // aria-describedby points at whichever helper texts exist (error wins focus order).
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  // Size → vertical padding + font scale. Keeps the .form-control look, just denser/looser.
  const sizePad = size === 'sm' ? '6px 10px' : size === 'lg' ? '12px 14px' : '9px 12px';
  const sizeFont = size === 'lg' ? '1rem' : '0.875rem';

  // Inner input style: slot padding is handled by the wrapper, so neutralize side padding
  // only when a slot is present (otherwise keep the native .form-control padding).
  const inputStyle = {
    padding: sizePad,
    fontSize: sizeFont,
    ...(startSlot ? { paddingLeft: 0 } : null),
    ...(endSlot ? { paddingRight: 0 } : null),
    ...(startSlot || endSlot
      ? { border: 'none', background: 'transparent', flex: 1, minWidth: 0, boxShadow: 'none' }
      : null),
  };

  const input = (
    <input
      ref={ref}
      id={id}
      type={type}
      className="form-control"
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      // Controlled vs uncontrolled: pass exactly one of value/defaultValue.
      {...(value !== undefined ? { value, onChange } : { defaultValue, onChange })}
      aria-invalid={error ? true : undefined}
      aria-required={required ? true : undefined}
      aria-describedby={describedBy}
      style={inputStyle}
      {...rest}
    />
  );

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: 'var(--danger-text)', marginLeft: 2 }}>
              *
            </span>
          )}
        </label>
      )}

      {startSlot || endSlot ? (
        // Slot wrapper carries the field chrome so the bare input can sit flush between slots.
        <div
          className="form-control"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: `0 12px`,
            opacity: disabled ? 0.6 : undefined,
          }}
        >
          {startSlot && (
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--text-muted)', flexShrink: 0 }}>
              {startSlot}
            </span>
          )}
          {input}
          {endSlot && (
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--text-muted)', flexShrink: 0 }}>
              {endSlot}
            </span>
          )}
        </div>
      ) : (
        input
      )}

      {hint && (
        <small id={hintId} style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>
          {hint}
        </small>
      )}
      {error && (
        <small
          id={errorId}
          role="alert"
          style={{ display: 'block', marginTop: 4, color: 'var(--danger-text)' }}
        >
          {error}
        </small>
      )}
    </div>
  );
});
