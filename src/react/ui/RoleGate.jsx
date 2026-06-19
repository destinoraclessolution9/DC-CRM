// RoleGate — conditionally renders children based on the viewer's role level.
// Role levels: LOWER number = MORE privileged (L1 = super admin). The gate's
// `level` prop is the LEAST-privileged level still allowed through, so a viewer
// passes when their level is numerically <= the gate's level.
// No DOM wrapper is emitted — children render inline (fragment) or the fallback.

export function RoleGate({ level, userLevel, children, fallback = null }) {
  // Prefer the explicit prop; otherwise resolve the current user's level off the
  // real app surface: window._appState.cu (live current user) → window._crmUtils
  // .getUserLevel(user). There is no zero-arg app.getCurrentUserLevel() in the
  // codebase, so calling it always returned undefined and the ?? 99 fallback
  // permanently locked everyone out. Default to 99 ("no privileges") only when
  // the level genuinely can't be resolved — fail closed, not open.
  const lvl =
    typeof userLevel === 'number'
      ? userLevel
      : (window._crmUtils?.getUserLevel?.(window._appState?.cu) ?? 99);

  // Numeric guard: a non-numeric or missing `level` should also fail closed.
  const gate = typeof level === 'number' ? level : -1;

  return lvl <= gate ? <>{children}</> : fallback;
}
