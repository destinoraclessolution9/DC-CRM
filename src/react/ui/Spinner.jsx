import { useMemo } from 'react';

// Size token → font-size. The spinner is an icon, so size maps to type scale.
const SIZE_FONT = {
  sm: '0.875rem', // 14px
  md: '1.125rem', // 18px
  lg: '1.5rem',   // 24px
};

/**
 * Inline spinner.
 *
 * - decorative: renders ONLY the spinning icon, aria-hidden (announces nothing).
 *   Use inside a control that already conveys busy/loading state (e.g. a Button
 *   with aria-busy) so screen readers don't double-announce.
 * - otherwise: role="status" wrapper with a visually-hidden label for SR users.
 *
 * Honors prefers-reduced-motion: when reduced, the icon does not spin (static
 * fa-spinner). We branch on the media query rather than animating in JS, so
 * there is no animation to guard at runtime — the class swap is the guard.
 */
export function Spinner({ size = 'md', label = 'Loading', decorative = false }) {
  // Evaluated once per mount; matchMedia is unavailable in non-DOM environments
  // (SSR/tests), so fall back to "motion allowed".
  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const fontSize = SIZE_FONT[size] || SIZE_FONT.md;

  // currentColor keeps the spinner in step with the surrounding text/button color.
  const iconClass = `fas fa-spinner${reduceMotion ? '' : ' fa-spin'}`;
  const icon = (
    <i
      className={iconClass}
      aria-hidden="true"
      style={{ fontSize, color: 'currentColor', lineHeight: 1 }}
    />
  );

  if (decorative) {
    return icon;
  }

  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
