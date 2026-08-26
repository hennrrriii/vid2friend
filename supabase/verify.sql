-- ===========================================================================
-- vid2friend :: setup verification
-- ===========================================================================
-- Run this in the Supabase SQL editor right after applying the schema. It reads
-- nothing but catalog tables, changes nothing, and tells you in one output
-- whether the project is set up correctly.
--
-- Every row should say PASS. See README section 5 for what to do if one does not.
-- ===========================================================================

with expected_tables (name) as (
  values ('profiles'), ('profile_secrets'), ('friendships'), ('shares')
),
expected_functions (name) as (
  values ('current_profile_id'), ('are_friends'), ('recalculate_slots'),
         ('bootstrap_profile'), ('find_profile_by_code'), ('send_friend_request'),
         ('respond_friend_request'), ('remove_friend'), ('mark_share_watched'),
         ('dismiss_share'), ('undismiss_share'), ('reorder_shares'),
         ('friends_already_queued'), ('claim_profile'), ('rotate_recovery_token'),
         ('delete_account')
),
checks as (
  select
    'table: ' || e.name as check_name,
    case when t.tablename is null then 'MISSING' else 'PASS' end as result
  from expected_tables e
  left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name

  union all

  select
    'RLS enabled: ' || c.relname,
    case when c.relrowsecurity then 'PASS' else 'FAIL - RLS IS OFF' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('profiles', 'profile_secrets', 'friendships', 'shares')

  union all

  select
    'function: ' || e.name,
    case when p.proname is null then 'MISSING' else 'PASS' end
  from expected_functions e
  left join pg_proc p
    on p.proname = e.name
   and p.pronamespace = 'public'::regnamespace

  union all

  select
    'policies on ' || tablename,
    case when count(*) > 0 then 'PASS (' || count(*) || ')' else 'FAIL - NO POLICIES' end
  from pg_policies
  where schemaname = 'public'
  group by tablename

  union all

  select
    'realtime publication: ' || tablename,
    'PASS'
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'

  union all

  select
    'anonymous sign-ins enabled',
    case when exists (select 1 from auth.users where is_anonymous)
         then 'PASS (at least one anonymous user exists)'
         else 'UNKNOWN - no anonymous user yet, check the Auth settings toggle'
    end
)
select check_name, result
from checks
order by
  case when result like 'PASS%' then 2 else 1 end,  -- problems first
  check_name;
