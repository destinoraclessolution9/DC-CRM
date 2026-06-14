/**
 * Phase 4 (#14) — shared CRM domain + data-layer types.
 *
 * Single source of truth for row shapes and the AppDataStore surface so new
 * code (lib/, api/, migrated views) is type-checked. Generated DB types can
 * later replace the hand-written rows via `supabase gen types typescript`.
 */

// ── Domain rows (subset of columns the client uses) ──────────────────────────
export interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;            // legacy "Level N …" display string
  role_level?: number;     // Phase 2 (#6) authoritative numeric role
  reporting_to?: string | null;
  team_id?: string | null;
  status?: string | null;
}

export interface CustomerRow {
  id: number | string;
  full_name: string | null;
  nickname?: string | null;
  phone?: string | null;
  email?: string | null;
  ming_gua?: string | null;
  lifetime_value?: number | null;
  customer_since?: string | null;
  responsible_agent_id?: string | null;
  agent_id?: string | null;
  agent_eligible?: boolean | null;
  house_audit_status?: string | null;
  status?: string | null;
}

export interface ProspectRow {
  id: number | string;
  full_name: string | null;
  phone?: string | null;
  email?: string | null;
  responsible_agent_id?: string | null;
  status?: string | null;
  score?: number | null;
}

// ── queryAdvanced — the server-side filter/sort/paginate primitive ───────────
export interface QueryAdvancedOptions {
  filters?: Record<string, string | number | boolean>;
  search?: string;
  searchFields?: string[];
  sort?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  scopeField?: string;
  scopeValues?: Array<string | number>;
  scopeFields?: Array<{ field: string; values: Array<string | number> }>;
  select?: string;
  gte?: Record<string, string | number>;
  lte?: Record<string, string | number>;
  countMode?: "exact" | "planned" | null;
}

export interface QueryAdvancedResult<T = Record<string, unknown>> {
  data: T[];
  count: number | null;
  limit: number;
  offset: number;
}

export interface AppDataStore {
  getAll<T = Record<string, unknown>>(table: string, opts?: { fresh?: boolean; includeDeleted?: boolean }): Promise<T[]>;
  getById<T = Record<string, unknown>>(table: string, id: string | number): Promise<T | null>;
  queryAdvanced<T = Record<string, unknown>>(table: string, opts: QueryAdvancedOptions): Promise<QueryAdvancedResult<T>>;
  create<T = Record<string, unknown>>(table: string, record: Partial<T>): Promise<T>;
  update<T = Record<string, unknown>>(table: string, id: string | number, patch: Partial<T>): Promise<T>;
  delete(table: string, id: string | number): Promise<void>;
  searchCustomers(term: string, opts?: Record<string, unknown>): Promise<CustomerRow[]>;
  searchProspects(term: string, opts?: Record<string, unknown>): Promise<ProspectRow[]>;
}

declare global {
  interface Window {
    AppDataStore: AppDataStore;
    /** Phase 1 (#12) feature flag — opt views into server-side pagination. */
    __SERVER_TABLES?: boolean;
    app: Record<string, (...args: any[]) => any>;
    _appState: Record<string, any>;
    _crmUtils: Record<string, (...args: any[]) => any>;
    _loadChunk: (src: string) => Promise<void>;
  }
}
