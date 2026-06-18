// Avatar — round user/entity avatar. Renders an <img> when `src` is provided,
// otherwise falls back to up-to-2-letter initials on a token background.

// Pixel diameter per size token (sm 24 / md 36 / lg 48).
const SIZE_PX = { sm: 24, md: 36, lg: 48 };

/**
 * Derive up to two uppercase initials from a name:
 * first letters of the first and last whitespace-separated words.
 * Empty/whitespace name => '?' so the circle is never blank.
 */
function initialsOf(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] || '';
  const last = words.length > 1 ? words[words.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

/**
 * Avatar
 * @param {Object} props
 * @param {string} [props.name]  Accessible label + initials source.
 * @param {string} [props.src]   Image URL; when set, renders <img alt={name}>.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 */
export function Avatar({ name = '', src, size = 'md' }) {
  const diameter = SIZE_PX[size] || SIZE_PX.md;

  // Shared circle box; both image and initials variants use this footprint.
  const box = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: `${diameter}px`,
    height: `${diameter}px`,
    borderRadius: '50%',
    overflow: 'hidden',
    verticalAlign: 'middle',
  };

  if (src) {
    return (
      <img
        src={src}
        // Image carries the accessible name via alt; name doubles as alt text.
        alt={name}
        width={diameter}
        height={diameter}
        style={{ ...box, objectFit: 'cover' }}
      />
    );
  }

  return (
    <span
      // The visible initials are an abbreviation; aria-label gives the full name.
      role="img"
      aria-label={name || 'Avatar'}
      style={{
        ...box,
        // --accent-grad is the brand fill; fall back to the sunken token if the
        // gradient var is undefined so the circle always has a surface.
        background: 'var(--accent-grad, var(--bg-sunken))',
        color: 'var(--text-inverse)',
        // Scale the glyph with the circle; ~40% of diameter reads well at all sizes.
        fontSize: `${Math.round(diameter * 0.4)}px`,
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {/* Decorative text node; the accessible name lives on aria-label above. */}
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  );
}
