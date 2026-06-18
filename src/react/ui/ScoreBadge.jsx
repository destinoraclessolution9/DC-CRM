// ScoreBadge — renders a prospect/customer score grade using the global
// .score-badge / .score-<grade> CSS classes (which own all the coloring).
// No inline color: the classes are the single source of truth for the look.

/**
 * @param {Object} props
 * @param {string} [props.grade] e.g. 'A+', 'A', 'B', 'C', 'D'
 */
export function ScoreBadge({ grade }) {
  // Sanitize to the class-safe charset [A-Za-z+-] so an untrusted grade value
  // can never break out of the className (no whitespace/dots/quotes leak into
  // the class list). Empty grade => no modifier suffix, shows an em-dash.
  const safe = typeof grade === 'string' ? grade.replace(/[^A-Za-z+-]/g, '') : '';

  return (
    <span className={`score-badge${safe ? ` score-${safe}` : ''}`}>
      {grade || '—'}
    </span>
  );
}
