import { forwardRef, useCallback } from 'react';

/**
 * Button — the canonical action primitive.
 *
 * Variants map onto the existing global `.btn` family:
 *   primary  => 'btn primary'
 *   danger   => 'btn danger'
 *   ghost    => 'btn ghost'
 *   link     => 'btn link'
 *   secondary=> 'btn secondary' (default)
 *
 * Loading is intentionally NOT `disabled`: a disabled button leaves the tab
 * order and drops its accessible name from some AT. Instead we keep the button
 * enabled, advertise `aria-busy`, and no-op the click while loading so the
 * control stays focusable and announced.
 */
export const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    startIcon,
    endIcon,
    type = 'button',
    onClick,
    children,
    style,
    className,
    ...rest
  },
  ref
) {
  // Build the class list off the shared `.btn` vocabulary.
  const classes = ['btn'];
  // ghost/link share the literal-name pattern with primary/danger/secondary.
  classes.push(variant); // 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
  if (size === 'sm') classes.push('btn-sm');
  else if (size === 'lg') classes.push('btn-lg');
  if (className) classes.push(className);

  // While loading, swallow clicks so consumers don't double-fire async work.
  const handleClick = useCallback(
    (e) => {
      if (loading) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    },
    [loading, onClick]
  );

  // md/lg honor the 44px touch target; sm is a compact/inline control.
  const minHeight = size === 'sm' ? undefined : 'var(--touch-target)';

  const mergedStyle = {
    ...(fullWidth ? { width: '100%' } : null),
    ...(minHeight ? { minHeight } : null),
    // Keep icon + label aligned with a small consistent gap.
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    ...style,
  };

  return (
    <button
      ref={ref}
      type={type}
      className={classes.join(' ')}
      // Only the explicit `disabled` prop removes the control; loading does not.
      disabled={disabled || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      style={mergedStyle}
      {...rest}
    >
      {loading && <i className="fas fa-spinner fa-spin" aria-hidden="true" />}
      {!loading && startIcon}
      {children}
      {!loading && endIcon}
    </button>
  );
});
