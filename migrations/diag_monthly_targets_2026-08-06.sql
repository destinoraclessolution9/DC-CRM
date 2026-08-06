-- One row, two columns. Paste with NOTHING selected and send back both values.
--
-- This settles the last open question: whether the REST API is serving a different
-- object than the one the ALTERs are hitting. Everything else has been eliminated —
-- transaction rollback, search_path shadowing, PostgREST's schema cache (survived a
-- NOTIFY and a full project restart), and wrong-project (ref confirmed both sides).
--
-- What to look for:
--   objects_named_monthly_targets — if this lists MORE THAN ONE entry, that is the
--       answer: the ALTERs go to public.* while PostgREST serves the other schema.
--       relkind r = ordinary table, v = view, m = materialised view, p = partitioned.
--   public_columns — the true column list of public.monthly_targets. If is_manual is
--       present here but the REST API still denies it, the mismatch is in which schema
--       PostgREST is configured to expose.
--
-- ALSO, and quicker than any SQL: Supabase dashboard -> Settings -> API ->
-- "Exposed schemas". If `public` is NOT in that list, that alone explains every
-- observation in this investigation.

select
  (select string_agg(
            n.nspname || '.' || c.relname || ' [' || c.relkind || ']', '  |  '
            order by n.nspname)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'monthly_targets')                       as objects_named_monthly_targets,

  (select string_agg(a.attname, ', ' order by a.attnum)
     from pg_attribute a
    where a.attrelid = 'public.monthly_targets'::regclass
      and a.attnum > 0
      and not a.attisdropped)                                  as public_columns;
