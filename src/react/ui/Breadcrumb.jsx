import { Fragment } from 'react';

/**
 * Breadcrumb — navigation trail.
 *
 * items: [{ label, href?, onClick? }]
 *   - Every item except the LAST renders as an interactive link (href and/or onClick).
 *   - The LAST item is the current page: plain text, aria-current="page", non-interactive.
 *
 * Separators are decorative spans (aria-hidden) so screen-reader users hear a clean
 * "list, N items" structure without the "/" noise.
 */
export function Breadcrumb({ items = [] }) {
  if (!items.length) return null;

  const lastIndex = items.length - 1;

  // Muted trail color; the current (last) crumb is promoted to primary text.
  const olStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--radius-sm)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontSize: 'var(--font-size-sm, 0.875rem)',
  };

  const sepStyle = {
    color: 'var(--text-muted)',
    userSelect: 'none',
    lineHeight: 1,
  };

  const linkStyle = {
    color: 'var(--text-muted)',
    textDecoration: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    cursor: 'pointer',
  };

  const currentStyle = {
    color: 'var(--text-primary)',
    fontWeight: 600,
  };

  return (
    <nav aria-label="Breadcrumb">
      <ol style={olStyle}>
        {items.map((item, i) => {
          const isLast = i === lastIndex;
          // Stable-ish key: prefer href, fall back to label+index.
          const key = item.href || `${item.label}-${i}`;

          return (
            <Fragment key={key}>
              <li
                style={{ display: 'flex', alignItems: 'center' }}
                {...(isLast ? { 'aria-current': 'page' } : {})}
              >
                {isLast ? (
                  <span style={currentStyle}>{item.label}</span>
                ) : item.href ? (
                  // Real anchor when an href is supplied (right-click / open-in-new-tab works).
                  <a
                    href={item.href}
                    style={linkStyle}
                    onClick={item.onClick}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--accent)';
                      e.currentTarget.style.textDecoration = 'underline';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                      e.currentTarget.style.textDecoration = 'none';
                    }}
                  >
                    {item.label}
                  </a>
                ) : (
                  // No href: render a button so keyboard/AT treat it as an action, not a link.
                  <button
                    type="button"
                    style={linkStyle}
                    onClick={item.onClick}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--accent)';
                      e.currentTarget.style.textDecoration = 'underline';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                      e.currentTarget.style.textDecoration = 'none';
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" style={sepStyle}>
                  /
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
