import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Spinner } from './Spinner.jsx';

/**
 * Combobox — async, SERVER-BACKED single-select combobox.
 *
 * The missing scale primitive: it NEVER filters a full client-side list. Every
 * keystroke (after a ~250ms debounce) aborts the previous in-flight request via
 * AbortController and calls `loadOptions(query, { signal, limit, offset })`,
 * so the server does the filtering/paging and the wire stays bounded.
 *
 *   id           — optional input id (else auto via useId)
 *   label        — field label (wired to the input via htmlFor)
 *   value        — controlled selected value (string | number | null)
 *   onChange     — called with the selected option's `value` on selection
 *   loadOptions  — (query, { signal, limit, offset }) => Promise<{ items: [{ value, label }] }>
 *   placeholder  — input placeholder
 *   hint         — helper text (aria-describedby)
 *   error        — error text (aria-describedby + aria-invalid + role=alert)
 *   required     — marks the field required
 *   disabled     — disables the input + popup
 *   pageSize     — request limit per load (default 20)
 *   minChars     — min query length before a request fires (default 0 => load on open)
 *   emptyText    — message shown when a settled, non-empty query yields no items
 *
 * Accessibility: full WAI-ARIA combobox (input role=combobox + aria-expanded /
 * aria-controls / aria-autocomplete=list / aria-activedescendant; popup
 * role=listbox; rows role=option with stable ids + aria-selected). The active
 * descendant moves via aria-activedescendant only — DOM focus stays on the input.
 */
export const Combobox = forwardRef(function Combobox(
  {
    id: idProp,
    label,
    value,
    onChange,
    loadOptions,
    placeholder,
    hint,
    error,
    required,
    disabled,
    pageSize = 20,
    minChars = 0,
    emptyText = 'No matches',
    ...rest
  },
  ref
) {
  // Stable ids; only rendered helpers get referenced by aria-describedby.
  const autoId = useId();
  const id = idProp || autoId;
  const listId = `${id}-listbox`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const statusId = `${id}-status`;
  // error wins focus order; status (live region) trails so SR users hear results.
  const describedBy =
    [errorId, hintId, statusId].filter(Boolean).join(' ') || undefined;

  // The text the user has typed. Distinct from the committed `value`.
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Index into `items` of the active descendant, or -1 for none.
  const [activeIndex, setActiveIndex] = useState(-1);

  // The latest abort controller, so a new keystroke can cancel the prior fetch.
  const abortRef = useRef(null);
  // Guards stale resolutions: only the newest request may commit results.
  const reqIdRef = useRef(0);
  // Debounce timer handle.
  const debounceRef = useRef(null);
  // Root element, for click-outside detection.
  const rootRef = useRef(null);
  // Local input ref so we can keep focus/caret logic even when a forwarded ref is given.
  const innerRef = useRef(null);
  const setInputRef = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  const optionId = (i) => `${id}-opt-${i}`;

  // Cancel any in-flight request + pending debounce. Called on new keystrokes,
  // close, and unmount so we never commit results from an abandoned query.
  const cancelInFlight = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // Fire a server request for `q`. Aborts the prior one first; results commit
  // only if this is still the newest request when the promise settles.
  const runLoad = useCallback(
    (q) => {
      if (typeof loadOptions !== 'function') return;
      // Below the min query length: don't hit the server, clear results.
      if (q.length < minChars) {
        setItems([]);
        setActiveIndex(-1);
        setLoading(false);
        setLoadError(false);
        return;
      }

      // Abort the previous fetch and start a fresh signal.
      if (abortRef.current) abortRef.current.abort();
      const controller =
        typeof AbortController !== 'undefined' ? new AbortController() : null;
      abortRef.current = controller;

      const myReq = ++reqIdRef.current;
      setLoading(true);
      setLoadError(false);

      Promise.resolve(
        loadOptions(q, {
          signal: controller ? controller.signal : undefined,
          limit: pageSize,
          offset: 0,
        })
      )
        .then((res) => {
          // Ignore stale resolutions (a newer keystroke superseded this one).
          if (myReq !== reqIdRef.current) return;
          const next = Array.isArray(res && res.items) ? res.items : [];
          setItems(next);
          setActiveIndex(next.length ? 0 : -1);
          setLoading(false);
        })
        .catch((err) => {
          // Aborts are expected control flow — they are not errors to surface.
          if (err && (err.name === 'AbortError' || err.code === 20)) return;
          if (myReq !== reqIdRef.current) return;
          setItems([]);
          setActiveIndex(-1);
          setLoading(false);
          setLoadError(true);
        });
    },
    [loadOptions, minChars, pageSize]
  );

  // Debounced reaction to query changes while the popup is open. Re-running on
  // every keystroke restarts the 250ms timer, so only the settled query fires.
  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runLoad(query);
    }, 250);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query, open, runLoad]);

  // Tear down any pending request/timer on unmount.
  useEffect(() => cancelInFlight, [cancelInFlight]);

  // Click-outside closes the popup (mousedown so it beats option onClick? — no:
  // option selection uses onMouseDown to commit before the input blurs, and the
  // listener ignores clicks inside the root, so both coexist).
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        closePopup();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openPopup = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const closePopup = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    cancelInFlight();
    setLoading(false);
  }, [cancelInFlight]);

  // Commit a selection: report the value, mirror its label into the input, close.
  const selectItem = useCallback(
    (item) => {
      if (!item) return;
      onChange?.(item.value);
      setQuery(item.label != null ? String(item.label) : '');
      closePopup();
      // Return focus to the input for continued keyboard flow.
      if (innerRef.current) innerRef.current.focus();
    },
    [onChange, closePopup]
  );

  const onInputChange = (e) => {
    setQuery(e.target.value);
    setLoadError(false);
    if (!open) openPopup();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const count = items.length;

    // Opening keys: ArrowDown/Up open a closed popup before navigating.
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openPopup();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!count) return;
        setActiveIndex((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!count) return;
        setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
        break;
      case 'Home':
        if (!open || !count) return;
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        if (!open || !count) return;
        e.preventDefault();
        setActiveIndex(count - 1);
        break;
      case 'Enter':
        if (open && activeIndex >= 0 && activeIndex < count) {
          e.preventDefault();
          selectItem(items[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closePopup();
        }
        break;
      default:
        break;
    }
  };

  // Keep the active row scrolled into view as the active descendant moves.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(optionId(activeIndex));
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open]);

  const activeDescId =
    open && activeIndex >= 0 && activeIndex < items.length
      ? optionId(activeIndex)
      : undefined;

  // Live-region summary for SR users (mirrors what the popup shows).
  const statusText = !open
    ? ''
    : loadError
    ? 'Could not load options'
    : loading
    ? 'Loading options'
    : items.length
    ? `${items.length} option${items.length === 1 ? '' : 's'} available`
    : emptyText;

  return (
    <div className="form-group" ref={rootRef} style={{ position: 'relative' }}>
      {label && (
        <label htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: 'var(--danger-text)', marginLeft: 2 }}>
              *
            </span>
          )}
        </label>
      )}

      <input
        ref={setInputRef}
        id={id}
        className="form-control"
        type="text"
        role="combobox"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        value={query}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onFocus={openPopup}
        onClick={openPopup}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={activeDescId}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />

      {open && (
        <ul
          role="listbox"
          id={listId}
          aria-label={label || placeholder || 'Options'}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 4,
            position: 'absolute',
            zIndex: 50,
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 4,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {loading && (
            <li
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
              }}
            >
              <Spinner size="sm" decorative />
              <span>Loading…</span>
            </li>
          )}

          {!loading && loadError && (
            <li
              role="alert"
              style={{
                padding: '8px 10px',
                color: 'var(--danger-text)',
                fontSize: '0.875rem',
              }}
            >
              Could not load options
            </li>
          )}

          {!loading &&
            !loadError &&
            items.map((item, i) => {
              const isActive = i === activeIndex;
              const selected = value != null && String(value) === String(item.value);
              return (
                <li
                  key={`${item.value}-${i}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  // onMouseDown (not onClick) commits before the input blurs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectItem(item);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)',
                    background: isActive ? 'var(--bg-sunken)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                  {selected && (
                    <i
                      className="fas fa-check"
                      aria-hidden="true"
                      style={{ color: 'var(--success-text)', fontSize: '0.75rem', flexShrink: 0 }}
                    />
                  )}
                </li>
              );
            })}

          {!loading && !loadError && items.length === 0 && (
            <li
              // Not role=option: it's a message, not a selectable choice.
              style={{
                padding: '8px 10px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
              }}
            >
              {emptyText}
            </li>
          )}
        </ul>
      )}

      {/* Polite live region mirroring popup state for screen readers. */}
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {hint && (
        <small id={hintId} style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>
          {hint}
        </small>
      )}
      {error && (
        <small
          id={errorId}
          role="alert"
          style={{ display: 'block', marginTop: 4, color: 'var(--danger-text)' }}
        >
          {error}
        </small>
      )}
    </div>
  );
});
