import { useId, useRef, useState, useCallback } from 'react';
import { useRovingTabIndex } from './useRovingTabIndex.js';

/**
 * Tabs — APG tabs pattern with roving tabindex.
 *
 * tabs: [{ id, label, content }]
 * Controlled via `value` + `onChange`, or uncontrolled via `defaultValue`.
 *
 * Per the APG "tabs with automatic activation" pattern, the roving tabindex
 * handles Left/Right/Home/End focus movement, and we activate (select) the tab
 * that receives focus — so arrow keys both move and select.
 */
export function Tabs({ tabs = [], value, onChange, defaultValue }) {
  const baseId = useId();
  const tablistRef = useRef(null);

  // Roving tabindex over the tab buttons (horizontal arrow navigation).
  useRovingTabIndex(tablistRef, { selector: '[role="tab"]', orientation: 'horizontal' });

  const isControlled = value !== undefined;
  const firstId = tabs.length ? tabs[0].id : undefined;
  const [internal, setInternal] = useState(defaultValue !== undefined ? defaultValue : firstId);
  const active = isControlled ? value : internal;

  // Resolve the active tab, falling back to the first tab if the id is unknown.
  const activeTab = tabs.find((t) => t.id === active) || tabs[0];
  const activeId = activeTab ? activeTab.id : undefined;

  const select = useCallback(
    (id) => {
      if (!isControlled) setInternal(id);
      onChange?.(id);
    },
    [isControlled, onChange],
  );

  // Stable element ids tying each tab to its panel for aria wiring.
  const tabElId = (id) => `${baseId}-tab-${id}`;
  const panelElId = (id) => `${baseId}-panel-${id}`;

  if (!tabs.length) return null;

  return (
    <div>
      <div
        ref={tablistRef}
        role="tablist"
        // Roving tabindex keeps Tab focus on the tablist as a single stop;
        // arrows move within. No fixed orientation aria needed for horizontal default.
        style={{
          display: 'flex',
          gap: 'var(--radius-sm)',
          borderBottom: '1px solid var(--border-soft)',
        }}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={tabElId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelElId(tab.id)}
              // Roving hook overrides tabIndex; this is the sensible initial value.
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              // Activate on focus so arrow navigation selects per APG automatic activation.
              onFocus={() => select(tab.id)}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                padding: '0.625rem 1rem',
                minHeight: 'var(--touch-target)',
                font: 'inherit',
                fontWeight: selected ? 600 : 500,
                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                // Selected underline sits on the shared tablist border.
                borderBottom: selected
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
                marginBottom: '-1px',
                outlineOffset: '2px',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <div
            key={tab.id}
            id={panelElId(tab.id)}
            role="tabpanel"
            aria-labelledby={tabElId(tab.id)}
            hidden={!selected}
            tabIndex={0}
            style={{ paddingTop: '1rem', outlineOffset: '2px' }}
          >
            {selected ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
