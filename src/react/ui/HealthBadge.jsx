// HealthBadge — BRIDGE component. The ONLY place raw app-produced HTML is injected
// into React. Kept tiny and explicitly named so the dangerouslySetInnerHTML usage
// is auditable and quarantined here (never spread into general UI components).
//
// The app function renderQuickHealthBadge(entity) returns a pre-built HTML string
// (already styled/escaped by the legacy app layer). We trust it because it is
// app-internal output — but we still guard the empty case so React renders nothing
// rather than an empty injected span.

const app = () => window.app || {};

export function HealthBadge({ entity, ...rest }) {
  // App owns the markup + escaping; we only relay it. Guard falsy/empty.
  const html = app().renderQuickHealthBadge?.(entity) || '';
  if (!html) return null;

  return (
    <span
      // QUARANTINED raw-HTML injection — app-produced string only, see file header.
      dangerouslySetInnerHTML={{ __html: html }}
      {...rest}
    />
  );
}
