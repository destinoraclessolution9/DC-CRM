import { forwardRef } from 'react';

/**
 * IconButton — icon-only button primitive.
 *
 * Icon-only controls have no visible text label, so `aria-label` is REQUIRED:
 * we throw at render if it is missing to fail loud in dev rather than ship an
 * inaccessible control to production.
 *
 * `icon` may be a Font Awesome class string (rendered as a decorative <i>) or
 * an arbitrary node (rendered as-is — caller owns its aria-hidden).
 */

// Per-variant subtle background tint. Tokens only — never hardcode color.
// `bg` is a translucent fill, `color`/`border` come from tokens. The danger
// foreground uses --danger-text (the AA-contrast pairing), never raw --danger.
const VARIANT_STYLE = {
  primary: {
    color: 'var(--text-inverse)',
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
  },
  secondary: {
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-soft)',
  },
  danger: {
    color: 'var(--danger-text)',
    // soft translucent fill so the icon stays readable; raw --danger is fill-only
    background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
  },
  ghost: {
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: '1px solid transparent',
  },
  link: {
    color: 'var(--accent)',
    background: 'transparent',
    border: '1px solid transparent',
  },
};

// Square hit areas. Never go below var(--touch-target) (44px) for the md/lg
// sizes; sm stays visually compact but still spaces generously.
const SIZE_STYLE = {
  sm: { width: 32, height: 32, fontSize: '0.8125rem', borderRadius: 'var(--radius-sm)' },
  md: {
    width: 'var(--touch-target)',
    height: 'var(--touch-target)',
    fontSize: '0.9375rem',
    borderRadius: 'var(--radius-md)',
  },
  lg: { width: 52, height: 52, fontSize: '1.0625rem', borderRadius: 'var(--radius-md)' },
};

export const IconButton = forwardRef(function IconButton(
  {
    icon,
    variant = 'secondary',
    size = 'md',
    disabled = false,
    type = 'button',
    onClick,
    style,
    ...rest
  },
  ref,
) {
  // Hard accessibility contract: an icon-only control MUST be labelled.
  const ariaLabel = rest['aria-label'];
  if (!ariaLabel) {
    throw new Error('IconButton requires aria-label');
  }

  const variantStyle = VARIANT_STYLE[variant] || VARIANT_STYLE.secondary;
  const sizeStyle = SIZE_STYLE[size] || SIZE_STYLE.md;

  // String icon => decorative Font Awesome glyph (label lives on the button).
  // Node icon => render as given; caller is responsible for its semantics.
  const iconNode =
    typeof icon === 'string' ? <i className={icon} aria-hidden="true" /> : icon;

  return (
    <button
      ref={ref}
      type={type}
      className="btn-icon"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        lineHeight: 1,
        ...sizeStyle,
        ...variantStyle,
        ...style,
      }}
      {...rest}
    >
      {iconNode}
    </button>
  );
});
