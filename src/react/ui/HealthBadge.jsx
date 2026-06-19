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

  // Strip any caller-passed children / dangerouslySetInnerHTML out of `rest`:
  // children would collide with our injection (React throws "Can not set both
  // children and dangerouslySetInnerHTML"), and a caller dangerouslySetInnerHTML
  // could override the quarantined app-produced markup. Spreading `rest` BEFORE
  // our dangerouslySetInnerHTML also ensures it can never be overridden.
  const { children: _ignoredChildren, dangerouslySetInnerHTML: _ignoredHtml, ...safeRest } = rest;

  return (
    <span
      {...safeRest}
      // QUARANTINED raw-HTML injection — app-produced string only, see file header.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
