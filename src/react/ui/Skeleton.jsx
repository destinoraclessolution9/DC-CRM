// Skeleton — shimmer placeholder built on the global .skeleton-block class
// (which already runs the crm-shimmer animation). Purely decorative:
// aria-hidden so screen readers skip it. Pair with a Spinner/sr-only label
// at the call site when announcing load state matters.

// Deterministic per-row widths in the 60–95% band so a multi-row skeleton
// reads as ragged "text lines" rather than a uniform block. Module-level
// constant => not reallocated on every render.
const ROW_WIDTHS = [92, 78, 85, 64, 88, 72, 95, 60];

export function Skeleton({ rows = 3, width, height, circle = false }) {
  // Single-block mode: one block sized by the width/height props.
  // circle => square-ish + fully rounded (caller supplies matching w/h).
  if (rows <= 1) {
    return (
      <span
        className="skeleton-block"
        aria-hidden="true"
        style={{
          display: 'block',
          width: width != null ? width : '100%',
          height: height != null ? height : '1em',
          borderRadius: circle ? '50%' : 'var(--radius-sm)',
        }}
      />
    );
  }

  // Multi-row mode: stack `rows` bars with a gap, each at a varying width.
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--radius-sm)',
        width: width != null ? width : '100%',
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="skeleton-block"
          style={{
            display: 'block',
            width: `${ROW_WIDTHS[i % ROW_WIDTHS.length]}%`,
            height: height != null ? height : '1em',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      ))}
    </span>
  );
}
