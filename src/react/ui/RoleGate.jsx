// RoleGate — conditionally renders children based on the viewer's role level.
// Role levels: LOWER number = MORE privileged (L1 = super admin). The gate's
// `level` prop is the LEAST-privileged level still allowed through, so a viewer
// passes when their level is numerically <= the gate's level.
// No DOM wrapper is emitted — children render inline (fragment) or the fallback.

// Bridge to live app logic without holding a hard dependency on it.
const app = () => window.app || {};

export function RoleGate({ level, userLevel, children, fallback = null }) {
  // Prefer the explicit prop; otherwise ask the app for the current user's level.
  // Default to 99 (effectively "no privileges") so an unknown viewer is locked
  // out rather than accidentally granted access — fail closed, not open.
  const lvl =
    typeof userLevel === 'number'
      ? userLevel
      : app().getCurrentUserLevel?.() ?? 99;

  // Numeric guard: a non-numeric or missing `level` should also fail closed.
  const gate = typeof level === 'number' ? level : -1;

  return lvl <= gate ? <>{children}</> : fallback;
}
