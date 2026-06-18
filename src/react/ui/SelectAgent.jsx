import { forwardRef } from 'react';

/**
 * SelectAgent — generalizes the legacy "reassign agent" table cell into a
 * standalone, controlled primitive. Faithfully mirrors the AgentCell prefix
 * logic from CustomersTable/ProspectsTable so reassignment scoping stays
 * identical to the legacy renderers.
 *
 *   value       — currently-assigned agent id (string | number | null)
 *   onChange    — called with the raw e.target.value (string) on selection
 *   agents      — in-scope agents the caller may reassign to: [{ id, full_name }]
 *   agentNames  — id → display-name map, covering out-of-scope ids too
 *   canReassign — false => read-only <span> with the resolved name
 *   placeholder — title/aria-label for the inline control (default "Reassign agent")
 *
 * Read-only mode is a plain <span> (no interactive element). The editable mode
 * is a compact native <select className="form-control"> with:
 *   - a leading blank option,
 *   - the in-scope agents, and
 *   - a synthesized prefix option when the current value is out of scope but
 *     still has a known name, so the assignment is preserved/visible.
 *
 * The select is icon-free but visually label-less in a row context, so an
 * aria-label is always wired (from `placeholder`) to keep it accessible.
 */
export const SelectAgent = forwardRef(function SelectAgent(
  {
    value,
    onChange,
    agents = [],
    agentNames = {},
    canReassign = false,
    placeholder = 'Reassign agent',
    ...rest
  },
  ref
) {
  // Normalize to string for stable comparison against option values.
  const cid = value != null && value !== '' ? String(value) : '';

  if (!canReassign) {
    // Read-only: resolve the name for the current id; blank when unassigned/unknown.
    const name = cid ? agentNames[cid] || '' : '';
    return (
      <span style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
        {name}
      </span>
    );
  }

  // Mirror legacy AgentCell: decide on a synthesized prefix option + the value
  // the <select> should reflect, so out-of-scope-but-named assignments survive.
  const inScope = agents.some((a) => String(a.id) === cid);
  const cidName = agentNames[cid];

  let prefix = null; // { value, label } | null
  let selectVal = cid;
  if (!cid) {
    prefix = { value: '', label: '' };
    selectVal = '';
  } else if (inScope) {
    prefix = null;
    selectVal = cid;
  } else if (!cidName) {
    // Out of scope and no known name => fall back to blank rather than show a bare id.
    prefix = { value: '', label: '' };
    selectVal = '';
  } else {
    // Out of scope but named => preserve the assignment with a one-off option.
    prefix = { value: cid, label: cidName };
    selectVal = cid;
  }

  return (
    <select
      ref={ref}
      className="form-control"
      value={selectVal}
      title={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      // Compact inline sizing — matches the legacy reassign cell footprint.
      style={{ minWidth: 120, fontSize: 12, width: 'auto' }}
      {...rest}
    >
      {prefix ? <option value={prefix.value}>{prefix.label}</option> : null}
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.full_name || 'Agent'}
        </option>
      ))}
    </select>
  );
});
