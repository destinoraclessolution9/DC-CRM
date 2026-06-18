import { useState, useRef, useCallback, useId, cloneElement, isValidElement } from 'react';
import { useRovingTabIndex } from './useRovingTabIndex.js';
import { useFocusTrap } from './useFocusTrap.js';

/**
 * Menu — APG menu button pattern.
 *
 * `trigger` is a node rendered as the toggle button; we clone it to inject the
 * disclosure wiring (aria-haspopup/aria-expanded/aria-controls + onClick + ref)
 * so callers can pass any styled element (e.g. <Button/> or <IconButton/>).
 *
 * When open, a role="menu" popup renders role="menuitem" buttons. Arrow/Home/End
 * roving comes from useRovingTabIndex; Esc + click-outside close and restore focus
 * to the trigger (focus trap handles Esc + restore). Selecting an item runs
 * item.onSelect then closes.
 */
export function Menu({ trigger, items = [], align = 'start' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  // Roving tabindex across the menuitem buttons.
  useRovingTabIndex(menuRef, { selector: '[role="menuitem"]:not([disabled])', orientation: 'vertical' });

  const close = useCallback(() => setOpen(false), []);

  // Focus trap: move focus into the popup on open, Esc closes, restore focus to
  // whatever was focused before (the trigger) on deactivate.
  useFocusTrap(menuRef, { active: open, onEscape: close, restoreFocus: true });

  // Click-outside closes. Bound only while open; ignores clicks on the trigger
  // (the trigger's own onClick toggles, so we must not double-handle here).
  const onDocPointerDown = useCallback((e) => {
    if (menuRef.current?.contains(e.target)) return;
    if (triggerRef.current?.contains(e.target)) return;
    setOpen(false);
  }, []);

  const setOutsideListener = useCallback((node) => {
    // Attach/detach the document listener as the popup mounts/unmounts.
    menuRef.current = node;
    if (node) {
      document.addEventListener('pointerdown', onDocPointerDown, true);
    } else {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
    }
  }, [onDocPointerDown]);

  const handleSelect = useCallback((item) => {
    if (item.disabled) return;
    setOpen(false);
    // Run after close so the handler can open another overlay without us stealing focus back.
    item.onSelect?.();
  }, []);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  if (!isValidElement(trigger)) {
    throw new Error('Menu requires a valid React element as `trigger`.');
  }

  // Clone the caller's trigger element to wire disclosure semantics + our ref,
  // preserving any onClick they already attached.
  const triggerOnClick = trigger.props.onClick;
  const clonedTrigger = cloneElement(trigger, {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (e) => {
      triggerOnClick?.(e);
      toggle();
    },
  });

  const popupStyle = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    [align === 'end' ? 'right' : 'left']: 0,
    minWidth: 180,
    margin: 0,
    padding: 4,
    listStyle: 'none',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-md)',
    zIndex: 1000,
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {clonedTrigger}
      {open && (
        <ul
          ref={setOutsideListener}
          id={menuId}
          role="menu"
          aria-orientation="vertical"
          style={popupStyle}
        >
          {items.map((item, i) => (
            <li key={item.key ?? `${item.label}-${i}`} role="none" style={{ display: 'block' }}>
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                onClick={() => handleSelect(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  minHeight: 'var(--touch-target)',
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  opacity: item.disabled ? 0.5 : 1,
                  // Danger items use the AA-contrast danger foreground token.
                  color: item.danger ? 'var(--danger-text)' : 'var(--text-primary)',
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) e.currentTarget.style.background = 'var(--bg-sunken)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                onFocus={(e) => {
                  if (!item.disabled) e.currentTarget.style.background = 'var(--bg-sunken)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {item.icon && <i className={`fa ${item.icon}`} aria-hidden="true" />}
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
