-- ===========================================================================
-- vid2friend :: RLS verification
-- ===========================================================================
-- Checks that the policies in 03_rls.sql actually hold, using three synthetic
-- users. Every assertion is a claim about what one user must NOT be able to do
-- to another.
--
-- The whole script runs inside a transaction that ends in ROLLBACK, so it
-- leaves nothing behind and is safe to run against a live project. Paste it
-- into the Supabase SQL editor and press Run, or:
--
--   psql "$DATABASE_URL" -f supabase/tests/rls_test.sql
--
-- Success looks like: "RLS TEST SUITE PASSED" in the notices, and no error.
-- A failure raises immediately and names the assertion that broke.
-- ===========================================================================

begin;

-- --- setup, as the table owner -------------------------------------------
set local role postgres;

insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now());

insert into public.profiles (id, auth_uid, username) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Carol');

-- Bob and Carol are friends. Alice knows nobody.
insert into public.friendships (requester_id, addressee_id, status, responded_at)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'accepted', now());

-- --- helper ---------------------------------------------------------------
create or replace function pg_temp.become(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.check(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if not p_ok then
    raise exception 'RLS TEST FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- =========================================================================
-- Alice's point of view
-- =========================================================================
select pg_temp.become('11111111-1111-1111-1111-111111111111');

select pg_temp.check(
  'alice sees exactly one profile: her own',
  (select count(*) from public.profiles) = 1
);

select pg_temp.check(
  'alice cannot read bob''s profile row',
  not exists (select 1 from public.profiles where username = 'Bob')
);

select pg_temp.check(
  'alice cannot read anyone''s recovery token but her own',
  (select count(*) from public.profile_secrets) = 1
);

select pg_temp.check(
  'alice cannot see the friendship between bob and carol',
  (select count(*) from public.friendships) = 0
);

-- An UPDATE that matches no row under RLS silently affects zero rows, which is
-- the correct behaviour: no error, no change.
do $$
declare n int;
begin
  update public.profiles set username = 'Hacked' where username is not null;
  get diagnostics n = row_count;
  perform pg_temp.check('alice can only rename herself, not others', n = 1);
end;
$$;

-- Sending to a stranger must be refused. Both the RLS check and the trigger
-- would catch this; we only care that it does not go through.
do $$
begin
  begin
    insert into public.shares (sender_id, recipient_id, video_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'dQw4w9WgXcQ');
    perform pg_temp.check('alice cannot share with a non-friend', false);
  exception when others then
    perform pg_temp.check('alice cannot share with a non-friend', true);
  end;
end;
$$;

-- =========================================================================
-- Bob's point of view (friends with Carol)
-- =========================================================================
reset role;
select pg_temp.become('22222222-2222-2222-2222-222222222222');

select pg_temp.check(
  'bob sees himself and carol',
  (select count(*) from public.profiles) = 2
);

insert into public.shares (sender_id, recipient_id, video_id, video_title, channel_name, duration_seconds)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003',
        'dQw4w9WgXcQ', 'Test video', 'Test channel', 213);

select pg_temp.check(
  'the share became active in slot 0',
  (select slot_position from public.shares where video_id = 'dQw4w9WgXcQ') = 0
);

-- The sender must not be able to mark their own recommendation as watched,
-- otherwise the "has Carol seen it yet" feedback would be meaningless.
do $$
begin
  perform public.mark_share_watched((select id from public.shares where video_id = 'dQw4w9WgXcQ'));
  perform pg_temp.check(
    'sender cannot mark his own share watched',
    (select status from public.shares where video_id = 'dQw4w9WgXcQ') = 'active'
  );
end;
$$;

-- There is no UPDATE grant on shares at all, so a direct write must fail even
-- for the sender. sender_priority is changed through reorder_shares().
do $$
begin
  begin
    update public.shares set sender_priority = -99 where video_id = 'dQw4w9WgXcQ';
    perform pg_temp.check('direct UPDATE on shares is refused', false);
  exception when insufficient_privilege then
    perform pg_temp.check('direct UPDATE on shares is refused', true);
  end;
end;
$$;

-- =========================================================================
-- Carol's point of view (the recipient)
-- =========================================================================
reset role;
select pg_temp.become('33333333-3333-3333-3333-333333333333');

select pg_temp.check(
  'carol sees the share addressed to her',
  (select count(*) from public.shares) = 1
);

do $$
begin
  perform public.mark_share_watched((select id from public.shares where video_id = 'dQw4w9WgXcQ'));
  perform pg_temp.check(
    'recipient can mark a share watched',
    (select status from public.shares where video_id = 'dQw4w9WgXcQ') = 'watched'
  );
  perform pg_temp.check(
    'a watched share holds no slot any more',
    (select slot_position from public.shares where video_id = 'dQw4w9WgXcQ') is null
  );
end;
$$;

-- =========================================================================
-- Alice again: she must not see any of that
-- =========================================================================
reset role;
select pg_temp.become('11111111-1111-1111-1111-111111111111');

select pg_temp.check(
  'alice cannot see shares between bob and carol',
  (select count(*) from public.shares) = 0
);

reset role;

do $$ begin raise notice 'RLS TEST SUITE PASSED'; end; $$;

rollback;
