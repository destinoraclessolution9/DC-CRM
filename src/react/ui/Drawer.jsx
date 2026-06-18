import { useRef, useEffect, useId } from 'react';
import { useFocusTrap } from './useFocusTrap.js';

// Off-canvas panel anchored to a side. Traps focus while open, Esc + backdrop
// click close, locks body scroll, and disables the slide transition under
// prefers-reduced-motion.

const SIDES = {
  // For left/right the size controls width; for bottom it controls height.
  left: { axis: 'width', anchor: { top: 0, left: 0, bottom: 0 }, hidden: 'translateX(-100%)' },
  right: { axis: 'width', anchor: { top: 0, right: 0, bottom: 0 }, hidden: 'translateX(100%)' },
  bottom: { axis: 'height', anchor: { left: 0, right: 0, bottom: 0 }, hidden: 'translateY(100%)' },
};

const SIZE_MAP = {
  sm: '320px',
  md: '420px',
  lg: '560px',
};

export function Drawer({ open, onClose, side = 'right', size = 'md', title, children }) {
  const panelRef = useRef(null);
  const titleId = useId();

  // Trap focus, move focus in, restore on close, and wire Esc -> onClose.
  useFocusTrap(panelRef, { active: !!open, onEscape: onClose });

  // Lock body scroll while the drawer is open; restore the prior value on close.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const config = SIDES[side] || SIDES.right;
  const dimension = SIZE_MAP[size] || size; // allow raw CSS length passthrough
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const panelStyle = {
    position: 'fixed',
    ...config.anchor,
    [config.axis]: dimension,
    maxWidth: config.axis === 'width' ? '100vw' : undefined,
    maxHeight: config.axis === 'height' ? '100vh' : undefined,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-surface)',
    boxShadow: 'var(--shadow-lg)',
    color: 'var(--text-primary)',
    zIndex: 1001,
    // Slide-in: start at hidden offset then settle. Skipped when reduced motion.
    animation: reduceMotion ? undefined : 'drawer-slide-in 180ms ease-out',
  };

  return (
    <div
      // Backdrop: click outside the panel closes the drawer.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1000,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        aria-labelledby={title ? titleId : undefined}
        style={panelStyle}
      >
        {/* Inline keyframes so the component is self-contained; ignored when reduced-motion guards it off above. */}
        <style>{`@keyframes drawer-slide-in { from { transform: ${config.hidden}; } to { transform: none; } }`}</style>

        {title ? (
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--radius-md)',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-soft)',
              flex: '0 0 auto',
            }}
          >
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: '1.0625rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              {title}
            </h2>
            <button
              type="button"
              className="btn-icon"
              aria-label="Close"
              onClick={() => onClose?.()}
              style={{
                minWidth: 'var(--touch-target)',
                minHeight: 'var(--touch-target)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </header>
        ) : null}

        <div
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
