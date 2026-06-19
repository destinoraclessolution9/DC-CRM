import { useMemo } from 'react';

// Bridge to live app logic — never throws if app or fn is absent.
const app = () => window.app || {};

// Default protection window (days). The legacy CRM treats 60 days as the full
// retention/protection horizon. If the app ever exposes a configured max we
// prefer it; otherwise this sensible default holds.
const DEFAULT_WINDOW_DAYS = 60;

// Tone thresholds (inclusive lower bounds checked top-down):
//   > 14 days  => healthy   (success)
//   4..14 days => expiring  (warning)
//   <= 3 days  => critical  (danger)
// Foreground tokens use the AA --*-text pairs so the fill stays legible.
function toneFor(days) {
  if (days > 14) return 'var(--success-text)';
  if (days > 3) return 'var(--warning-text)';
  return 'var(--danger-text)';
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * ProtectionBar — horizontal fill bar of a prospect's remaining protection days.
 *
 * Pulls the raw day count from app().calculateProtectionDays(prospect); a
 * missing/undefined/NaN result is treated as 0 (fully expired). The fill width
 * is the percentage of the protection window remaining, and its color shifts
 * from success → warning → danger as the count drops.
 *
 * Exposed as a native progressbar so assistive tech reads the remaining days.
 */
export function ProtectionBar({ prospect, max = DEFAULT_WINDOW_DAYS }) {
  // Window must be a positive number to avoid divide-by-zero / NaN width.
  const windowDays = Number.isFinite(max) && max > 0 ? max : DEFAULT_WINDOW_DAYS;

  // Recompute only when the prospect identity or window changes — the bridge
  // call is cheap but we avoid re-deriving on unrelated parent re-renders.
  const days = useMemo(() => {
    // Prefer the live app calculation; fall back to the row's own field when the
    // bridge is absent (gallery / early-render / offline) so we don't render a
    // false "0d / expired" for a prospect that actually has days remaining.
    const raw =
      app().calculateProtectionDays?.(prospect) ??
      prospect?.protection_days_remaining;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
    // windowDays is not read here, so it's intentionally not a dependency.
  }, [prospect]);

  const pct = clamp((days / windowDays) * 100, 0, 100);
  const fillColor = toneFor(days);

  return (
    <div
      role="progressbar"
      aria-label="Protection days remaining"
      aria-valuenow={days}
      aria-valuemin={0}
      aria-valuemax={windowDays}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minWidth: 0,
      }}
    >
      {/* Track */}
      <div
        style={{
          position: 'relative',
          flex: '1 1 auto',
          height: '6px',
          minWidth: 0,
          background: 'var(--bg-sunken)',
          borderRadius: '999px',
          overflow: 'hidden',
        }}
      >
        {/* Fill — width is a pure style prop, no JS animation to guard. */}
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: fillColor,
            borderRadius: '999px',
          }}
        />
      </div>
      {/* Numeric label — concise; the progressbar carries the full a11y semantics. */}
      <span
        style={{
          flex: '0 0 auto',
          fontSize: '12px',
          fontWeight: 600,
          lineHeight: 1,
          color: fillColor,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {days}d
      </span>
    </div>
  );
}
