import { useEffect, useRef } from 'react';

// Focusable selector — excludes disabled controls and explicitly removed tabbables.
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\'-1\'])';

/**
 * useFocusTrap(ref, { active, onEscape, restoreFocus })
 *
 * While `active` is true, keeps keyboard focus within the node referenced by `ref`:
 *  - records the element that had focus before activation
 *  - moves focus to the first focusable descendant (next frame, so the node is painted)
 *  - traps Tab / Shift+Tab so focus cycles inside the node
 *  - calls `onEscape` when Escape is pressed
 * On deactivation (active -> false or unmount) it removes the handler and, when
 * `restoreFocus` is true, returns focus to the originally-focused element.
 *
 * Plain hook (no JSX). Used by overlays: Modal, Drawer, Menu.
 */
export function useFocusTrap(ref, { active, onEscape, restoreFocus = true } = {}) {
  // Keep latest onEscape without re-running the trap effect on every render.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;

    const node = ref && ref.current;
    if (!node) return;

    // Remember what had focus so we can restore it on cleanup.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = () =>
      Array.prototype.slice.call(node.querySelectorAll(FOCUSABLE_SELECTOR));

    // Move focus inside after paint; fall back to the container itself.
    const rafId = requestAnimationFrame(() => {
      const focusable = getFocusable();
      const first = focusable[0];
      if (first) {
        first.focus();
      } else if (typeof node.focus === 'function') {
        // Container should carry tabIndex={-1} to accept programmatic focus.
        node.focus();
      }
    });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onEscapeRef.current) onEscapeRef.current(e);
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing tabbable — keep focus pinned to the container.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        // Backwards off the first (or out of the trap) wraps to the last.
        if (activeEl === first || !node.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Forwards off the last (or out of the trap) wraps to the first.
        if (activeEl === last || !node.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Capture phase so we trap before app-level key handlers can intervene.
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, ref, restoreFocus]);
}
