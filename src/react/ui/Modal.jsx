import { useId, useRef, useEffect } from 'react';
import { useFocusTrap } from './useFocusTrap.js';

// Overlay sits above app chrome and centers its box. Reuses the global
// .modal-overlay / .modal-box CSS shell; inline tokens only fill gaps the
// stylesheet doesn't cover (z-index/centering), never hardcoded colors.
const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
};

// Size → max-width cap for the box. 'fullscreen' is handled via a class
// instead so the global stylesheet can own that layout if it wants to.
const SIZE_MAX_WIDTH = {
  sm: 420,
  md: 560,
  lg: 760,
};

/**
 * Modal — accessible dialog rendered into the standard .modal-overlay shell.
 *
 * Returns null when !open (no hidden DOM, no trap, no scroll lock).
 * - role="dialog" + aria-modal, labelled by the title and (when present)
 *   described by the description paragraph.
 * - useFocusTrap keeps Tab focus inside the box, closes on Esc, and restores
 *   focus to the previously-focused element on unmount.
 * - Clicking the overlay backdrop (but not the box) calls onClose.
 * - Body scroll is locked while open and restored on close/unmount.
 *
 * size: 'sm' | 'md' | 'lg' (default 'md') | 'fullscreen'.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
}) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const boxRef = useRef(null);

  // Trap focus + wire Esc-to-close while open; restores focus on deactivate.
  useFocusTrap(boxRef, { active: !!open, onEscape: onClose });

  // Lock body scroll for the lifetime of an open modal. Capturing the prior
  // inline value (rather than assuming '') keeps nested/late-mounted modals
  // from clobbering an existing lock when the outer one unwinds.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const isFullscreen = size === 'fullscreen';

  // Backdrop click closes, but only when the click originated on the overlay
  // itself — clicks bubbling up from inside the box must not dismiss.
  const onOverlayMouseDown = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="modal-overlay" style={OVERLAY_STYLE} onMouseDown={onOverlayMouseDown}>
      <div
        ref={boxRef}
        className={isFullscreen ? 'modal-box modal-box-fullscreen' : 'modal-box'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        style={
          isFullscreen
            ? { width: '100%', maxWidth: 'none', display: 'flex', flexDirection: 'column' }
            : {
                width: '100%',
                maxWidth: SIZE_MAX_WIDTH[size] || SIZE_MAX_WIDTH.md,
                display: 'flex',
                flexDirection: 'column',
              }
        }
      >
        <div className="modal-header">
          <h3 id={titleId} style={{ margin: 0 }}>
            {title}
          </h3>
          <button
            type="button"
            className="modal-close"
            aria-label="Close dialog"
            onClick={() => onClose?.()}
          >
            {/* Decorative glyph; the accessible name comes from aria-label. */}
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="modal-content">
          {description ? (
            <p id={descId} style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
              {description}
            </p>
          ) : null}
          {children}
        </div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
