import { forwardRef, useCallback } from 'react';

/**
 * Card — surface container.
 *
 * `as` chooses the rendered element ('div' | 'section' | 'article').
 * When `interactive` (or `onClick`) is set, the WHOLE card becomes a single
 * tab stop with button semantics (role=button, tabIndex 0, Enter/Space => onClick)
 * and lifts on hover via --shadow-md.
 *
 * Regions: header (top-left), actions (top-right, sits beside header), footer (bottom).
 */
export const Card = forwardRef(function Card(
  {
    as = 'div',
    header,
    footer,
    actions,
    interactive,
    onClick,
    children,
    padding,
    style,
    className,
    ...rest
  },
  ref
) {
  // A card is interactive if explicitly flagged OR an onClick handler is supplied.
  const isInteractive = Boolean(interactive || onClick);

  // Allow only the whitelisted semantic elements; fall back to div otherwise.
  const Tag = as === 'section' || as === 'article' ? as : 'div';

  // Resolve padding: explicit prop (number => px, or any CSS length string) or default 16px.
  const pad = padding == null ? '16px' : typeof padding === 'number' ? `${padding}px` : padding;

  // Keyboard activation for the button-like card: Enter and Space trigger onClick (APG button).
  const handleKeyDown = useCallback(
    (e) => {
      if (!isInteractive || !onClick) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        // Space would scroll the page; prevent that and activate instead.
        e.preventDefault();
        onClick(e);
      }
    },
    [isInteractive, onClick]
  );

  // Hover elevation handled in JS (no stylesheet hook) so it stays tokenized & self-contained.
  const handleMouseEnter = useCallback(
    (e) => {
      if (isInteractive) e.currentTarget.style.boxShadow = 'var(--shadow-md)';
    },
    [isInteractive]
  );
  const handleMouseLeave = useCallback(
    (e) => {
      if (isInteractive) e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    },
    [isInteractive]
  );

  const cardStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm)',
    padding: pad,
    color: 'var(--text-primary)',
    cursor: isInteractive ? 'pointer' : undefined,
    // No transition on the JS-driven shadow swap to respect reduced-motion implicitly
    // (instantaneous change is always safe).
    ...style,
  };

  const hasTop = header != null || actions != null;

  const interactiveProps = isInteractive
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: handleKeyDown,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
      }
    : {};

  return (
    <Tag ref={ref} className={className} style={cardStyle} {...interactiveProps} {...rest}>
      {hasTop && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: children != null || footer != null ? '12px' : 0,
          }}
        >
          {/* Header grows to fill; actions hug the right edge. */}
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>{header}</div>
          {actions != null && (
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {actions}
            </div>
          )}
        </div>
      )}

      {children != null && <div style={{ minWidth: 0 }}>{children}</div>}

      {footer != null && (
        <div
          style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-soft)',
            color: 'var(--text-secondary)',
          }}
        >
          {footer}
        </div>
      )}
    </Tag>
  );
});
