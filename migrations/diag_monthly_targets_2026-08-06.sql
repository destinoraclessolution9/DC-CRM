-- Paste this whole thing, nothing selected, and send back the grid it prints.
-- It cannot fail on data and it reports its own outcome.
alter table public.monthly_targets add column if not exists is_manual boolean not null default false;

select current_database()                                          as db,
       current_user                                                as run_as,
       current_setting('search_path')                              as search_path,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'monthly_targets'
           and column_name = 'is_manual')                          as is_manual_in_public,
       (select string_agg(table_schema, ', ' order by table_schema)
          from information_schema.tables
         where table_name = 'monthly_targets')                     as schemas_with_this_table;
