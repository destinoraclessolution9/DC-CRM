// Phase 2 — React UI component library barrel.
// Canonical import surface for the design system: `import { Button, Modal, … }
// from '../ui/index.js'`. Components are plain JSX (automatic runtime), reuse
// the shared styles-theme.css tokens + existing global classes, and ship
// DORMANT — nothing here is in the live island bundle until a view (Phase 4)
// imports it, so Vite tree-shakes the unused library out of react-island.js.

// ── Primitives ──────────────────────────────────────────────────────────────
export { Button } from './Button.jsx';
export { IconButton } from './IconButton.jsx';
export { Badge } from './Badge.jsx';
export { ScoreBadge } from './ScoreBadge.jsx';
export { Spinner } from './Spinner.jsx';
export { Skeleton } from './Skeleton.jsx';
export { TextField } from './TextField.jsx';
export { Textarea } from './Textarea.jsx';
export { Select } from './Select.jsx';
export { Combobox } from './Combobox.jsx';
export { Checkbox } from './Checkbox.jsx';
export { Switch } from './Switch.jsx';
export { Card } from './Card.jsx';
export { Avatar } from './Avatar.jsx';
export { Tooltip } from './Tooltip.jsx';
export { Tabs } from './Tabs.jsx';
export { Menu } from './Menu.jsx';
export { Pagination } from './Pagination.jsx';
export { Breadcrumb } from './Breadcrumb.jsx';

// ── Feedback ──────────────────────────────────────────────────────────────────
export { toast, useToast } from './Toast.js';

// ── States ──────────────────────────────────────────────────────────────────
export { EmptyState } from './EmptyState.jsx';
export { ErrorState } from './ErrorState.jsx';

// ── Overlays ──────────────────────────────────────────────────────────────────
export { Modal } from './Modal.jsx';
export { Drawer } from './Drawer.jsx';
export { ConfirmDialog } from './ConfirmDialog.jsx';

// ── Domain ──────────────────────────────────────────────────────────────────
export { SelectAgent } from './SelectAgent.jsx';
export { ProtectionBar } from './ProtectionBar.jsx';
export { HealthBadge } from './HealthBadge.jsx';
export { RoleGate } from './RoleGate.jsx';
export { StatCard } from './StatCard.jsx';

// ── Data table at scale (Phase 3) ────────────────────────────────────────────
export { VirtualizedDataTable } from './VirtualizedDataTable.jsx';
export { InfiniteList } from './InfiniteList.jsx';
export { useWindowedRows } from './useWindowedRows.js';
export { useInfiniteRows } from './useInfiniteRows.js';

// ── Hooks ──────────────────────────────────────────────────────────────────
export { useFocusTrap } from './useFocusTrap.js';
export { useRovingTabIndex } from './useRovingTabIndex.js';
