import { Card } from './Card.jsx';

/**
 * StatCard — a single KPI tile.
 *
 * Composition: wraps the sibling `Card` for the surface (border, radius, shadow,
 * tokenized background) and lays out label / value / optional icon + trend on top.
 *
 * Props:
 *   label  — short caption (rendered muted, small, uppercase + letter-spacing)
 *   value  — the headline number/string (large, bold, --text-primary)
 *   icon   — optional Font Awesome class string (e.g. 'fa-users'); shown in a
 *            tone-tinted circular chip. Decorative => aria-hidden.
 *   trend  — optional { dir: 'up' | 'down', text } pill. up => --success-text +
 *            caret-up, down => --danger-text + caret-down.
 *   tone   — 'neutral' | 'info' | 'success' | 'warning' | 'danger' (default
 *            'neutral'); tints the icon chip only.
 *
 * Accessibility: the value carries an aria-label that joins the label and value
 * ("Active prospects: 1,240") so a screen reader announces the metric as one
 * coherent unit instead of two disconnected scraps of text. The visual label and
 * value remain in the DOM for sighted users, so the chip and trend are decorative.
 */

// tone => the AA-compliant foreground text token. Status text MUST use the *-text
// pairs (raw --danger/--success fail WCAG AA on text), so we map carefully here.
const TONE_FG = {
  neutral: 'var(--text-secondary)',
  info: 'var(--info-text)',
  success: 'var(--success-text)',
  warning: 'var(--warning-text)',
  danger: 'var(--danger-text)',
};

// tone => a soft translucent background for the icon chip. color-mix keeps the
// tint derived from the same token (no hardcoded hex) and degrades gracefully.
const TONE_BG = {
  neutral: 'var(--bg-sunken)',
  info: 'color-mix(in srgb, var(--info-text) 14%, transparent)',
  success: 'color-mix(in srgb, var(--success-text) 14%, transparent)',
  warning: 'color-mix(in srgb, var(--warning-text) 14%, transparent)',
  danger: 'color-mix(in srgb, var(--danger-text) 14%, transparent)',
};

export function StatCard({ label, value, icon, trend, tone = 'neutral' }) {
  const fg = TONE_FG[tone] || TONE_FG.neutral;
  const chipBg = TONE_BG[tone] || TONE_BG.neutral;

  // Build the combined announcement only when both pieces are present and string-able.
  const ariaLabel =
    label != null && value != null ? `${label}: ${value}` : undefined;

  // Trend direction => caret icon + foreground token. 'up' is conventionally good
  // (success), 'down' bad (danger); callers pick `dir` to match their metric's polarity.
  const isUp = trend?.dir === 'up';
  const trendFg = isUp ? 'var(--success-text)' : 'var(--danger-text)';
  const trendCaret = isUp ? 'fa-caret-up' : 'fa-caret-down';

  return (
    <Card padding={16}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Text column: label over value, with the trend pill beneath. */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: '6px',
            }}
          >
            {label}
          </div>

          <div
            // aria-label fuses label+value into one spoken phrase; the visible
            // label above is then redundant noise for SR, so we leave it as-is
            // visually but rely on this node for the announcement.
            aria-label={ariaLabel}
            style={{
              fontSize: '28px',
              lineHeight: 1.1,
              fontWeight: 700,
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
            }}
          >
            {value}
          </div>

          {trend && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: trendFg,
              }}
            >
              <i className={`fas ${trendCaret}`} aria-hidden="true" />
              <span>{trend.text}</span>
            </div>
          )}
        </div>

        {/* Tone-tinted circular icon chip (decorative). */}
        {icon && (
          <div
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: chipBg,
              color: fg,
              fontSize: '18px',
            }}
          >
            <i className={`fas ${icon}`} />
          </div>
        )}
      </div>
    </Card>
  );
}
