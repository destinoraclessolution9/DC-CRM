/**
 * EmptyState — centered "nothing here yet" placeholder.
 *
 * role="status" so SR users hear the (non-urgent) message when it appears.
 * Layout: big muted FA icon, h4 title, muted description paragraph, optional
 * action node (typically a <Button>) the caller supplies.
 *
 * The icon is purely decorative (the title carries the meaning), so it is
 * aria-hidden and excluded from the accessible name.
 */
export function EmptyState({ icon = 'fa-inbox', title, description, action }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 20px',
        gap: '12px',
      }}
    >
      {icon && (
        <i
          // FA expects a style prefix; `fas` covers the solid set used app-wide.
          className={`fas ${icon}`}
          aria-hidden="true"
          style={{
            fontSize: '40px',
            lineHeight: 1,
            color: 'var(--text-muted)',
            opacity: 0.6,
          }}
        />
      )}

      {title && (
        <h4
          style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h4>
      )}

      {description && (
        <p
          style={{
            margin: 0,
            maxWidth: '40ch',
            fontSize: '0.875rem',
            lineHeight: 1.5,
            color: 'var(--text-muted)',
          }}
        >
          {description}
        </p>
      )}

      {action && <div style={{ marginTop: '4px' }}>{action}</div>}
    </div>
  );
}
