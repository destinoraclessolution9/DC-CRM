import { Button } from './Button.jsx';

/**
 * ErrorState — centered failure panel announced to assistive tech.
 *
 * role='alert' so the message is read immediately when it appears.
 * - retryable=true  => recoverable error, offers a "Retry" action.
 * - retryable=false => fatal error; copy nudges a full page reload and
 *   the action (if any) reads "Reload".
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryable = true,
}) {
  // Default copy depends on severity: recoverable vs fatal.
  const body =
    description ??
    (retryable
      ? 'An error occurred. Please try again.'
      : 'A problem prevented this from loading. Reload the page to continue.');

  const actionLabel = retryable ? 'Retry' : 'Reload';

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-sm, 8px)',
        padding: 'var(--space-lg, 24px)',
        maxWidth: '32rem',
        margin: '0 auto',
        color: 'var(--text-primary)',
      }}
    >
      {/* Decorative status icon — color carries no info on its own, the
          title + role='alert' convey the meaning, so hide it from AT. */}
      <i
        className="fa-solid fa-triangle-exclamation"
        aria-hidden="true"
        style={{
          fontSize: '2rem',
          lineHeight: 1,
          color: 'var(--danger-text)',
          marginBottom: 'var(--space-xs, 4px)',
        }}
      />

      <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>{title}</h4>

      <p style={{ margin: 0, color: 'var(--text-muted)' }}>{body}</p>

      {onRetry ? (
        <div style={{ marginTop: 'var(--space-sm, 8px)' }}>
          <Button
            variant="secondary"
            startIcon={
              // Decorative — the button's text label names the action.
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
            }
            onClick={onRetry}
          >
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
