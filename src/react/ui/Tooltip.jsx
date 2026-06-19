import { cloneElement, isValidElement, useId, useState, useCallback, useRef, useEffect } from 'react';

// Static placement offset map. Tip is absolutely positioned relative to a
// position:relative wrapper, so we anchor each edge and nudge with a transform.
const PLACEMENT_STYLES = {
  top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
  bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
  left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
  right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
};

const TIP_STYLE = {
  position: 'absolute',
  zIndex: 60,
  maxWidth: 240,
  width: 'max-content',
  padding: '6px 8px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-soft)',
  boxShadow: 'var(--shadow-md)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
  lineHeight: 1.4,
  pointerEvents: 'none', // never steal hover from the trigger
  whiteSpace: 'normal',
};

/**
 * Tooltip — wraps a single focusable child and shows `content` on hover AND
 * keyboard focus. Hides on blur, mouseleave, or Esc. The child is cloned to
 * receive aria-describedby (pointing at the tip) plus the event handlers, so
 * the relationship is announced to assistive tech without extra DOM.
 */
export function Tooltip({ content, children, placement = 'top' }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  // Reduced-motion: skip the fade entirely (we keep transitions trivial anyway).
  const reducedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    },
    [open],
  );

  // Compose our handlers with any the child already declared so we don't clobber them.
  const child = children;
  const childProps = child?.props || {};
  const compose = (ours, theirs) =>
    theirs
      ? (e) => {
          theirs(e);
          ours(e);
        }
      : ours;

  const placementStyle = PLACEMENT_STYLES[placement] || PLACEMENT_STYLES.top;

  const describedBy = open
    ? [childProps['aria-describedby'], tipId].filter(Boolean).join(' ')
    : childProps['aria-describedby'];

  // cloneElement requires a single valid React element. A string/number/null
  // child, or multiple children, would make it throw. Guard with isValidElement:
  // when the child isn't a valid single element, wrap it in a focusable <span>
  // so it can still receive hover/focus handlers + the aria-describedby link.
  const handlers = {
    onMouseEnter: compose(show, childProps.onMouseEnter),
    onMouseLeave: compose(hide, childProps.onMouseLeave),
    onFocus: compose(show, childProps.onFocus),
    onBlur: compose(hide, childProps.onBlur),
    onKeyDown: compose(onKeyDown, childProps.onKeyDown),
  };

  const trigger = isValidElement(child)
    ? cloneElement(child, { 'aria-describedby': describedBy, ...handlers })
    : (
        <span tabIndex={0} aria-describedby={describedBy} {...handlers}>
          {children}
        </span>
      );

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger}
      {/*
        Tip is always rendered with role=tooltip so the id target exists for
        aria-describedby; visibility is toggled rather than mounted/unmounted to
        avoid a flash of unstyled position during fast hover.
      */}
      <span
        id={tipId}
        role="tooltip"
        style={{
          ...TIP_STYLE,
          ...placementStyle,
          opacity: open ? 1 : 0,
          visibility: open ? 'visible' : 'hidden',
          transition: reducedRef.current ? 'none' : 'opacity 120ms ease',
        }}
      >
        {content}
      </span>
    </span>
  );
}
