import { useEffect } from 'react';

/**
 * useRovingTabIndex — APG roving-tabindex behavior for composite widgets
 * (menus, tablists, toolbars). Exactly one item is in the tab order
 * (tabIndex 0); the rest are -1. Arrow/Home/End move both focus and the
 * tabbable item. Items are re-queried on every keydown so dynamic lists work.
 *
 * @param {React.RefObject<HTMLElement>} ref  container holding the items
 * @param {{selector?: string, orientation?: 'vertical'|'horizontal'}} [opts]
 */
export function useRovingTabIndex(
  ref,
  { selector = "[role='menuitem'],[role='tab'],[data-roving]", orientation = 'vertical' } = {}
) {
  useEffect(() => {
    const container = ref && ref.current;
    if (!container) return undefined;

    const getItems = () => Array.from(container.querySelectorAll(selector));

    // Initialize tab order: first item tabbable (0), rest removed from order (-1).
    const init = getItems();
    init.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });

    // Which keys advance vs. retreat depends on orientation.
    const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

    const focusAt = (items, index) => {
      // Make the target the sole tabbable item, then move focus to it.
      items.forEach((el, i) => {
        el.tabIndex = i === index ? 0 : -1;
      });
      const target = items[index];
      if (target) target.focus();
    };

    const onKeyDown = (e) => {
      const items = getItems();
      if (items.length === 0) return;

      // Current index = focused item, falling back to the tabbable one.
      let current = items.indexOf(document.activeElement);
      if (current === -1) current = items.findIndex((el) => el.tabIndex === 0);
      if (current === -1) current = 0;

      let nextIndex = null;
      switch (e.key) {
        case nextKey:
          nextIndex = (current + 1) % items.length; // wrap to start
          break;
        case prevKey:
          nextIndex = (current - 1 + items.length) % items.length; // wrap to end
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = items.length - 1;
          break;
        default:
          return; // ignore everything else (let typing/Enter pass through)
      }

      e.preventDefault();
      focusAt(items, nextIndex);
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [ref, selector, orientation]);
}
