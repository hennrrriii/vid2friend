-- ===========================================================================
-- vid2friend :: 05 Realtime
-- ===========================================================================
-- The service worker subscribes to postgres_changes on these two tables so a
-- new recommendation shows up without a page reload. Realtime applies the same
-- RLS policies as a normal select, so a client only ever receives rows it could
-- have queried anyway.
--
-- REPLICA IDENTITY FULL is needed so that DELETE events carry enough of the old
-- row for RLS to decide whether we may see them. Without it, deletes arrive
-- with the primary key only and are filtered out.
-- ===========================================================================

alter table public.shares      replica identity full;
alter table public.friendships replica identity full;

do $realtime$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shares'
  ) then
    alter publication supabase_realtime add table public.shares;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end;
$realtime$;
