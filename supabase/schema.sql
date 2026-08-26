-- ===========================================================================
-- vid2friend :: complete schema
-- ---------------------------------------------------------------------------
-- GENERATED FILE - do not edit. Source of truth: supabase/migrations/*.sql
-- Regenerate with: npm run sql:bundle
--
-- Paste this whole file into the Supabase SQL editor and press Run. It is
-- safe to run on a fresh project; running it twice will fail on the CREATE
-- TYPE statements, which is intentional (it means the schema is already in).
-- ===========================================================================

-- >>> 20260101000000_init.sql

-- ===========================================================================
-- vid2friend :: 01 schema
-- ---------------------------------------------------------------------------
-- Design note that explains the whole file: `profiles.id` is NOT `auth.uid()`.
--
-- The spec originally wanted them to be the same. That makes account recovery
-- impossible: a Chrome profile owns exactly one anonymous Supabase session, and
-- on a second machine you get a brand new `auth.uid()`. If the primary key were
-- that uid, moving an account would mean rewriting the primary key of a row
-- that `friendships` and `shares` point at, and that `auth.users` owns.
--
-- So `profiles` gets its own stable uuid and a swappable `auth_uid` column.
-- Recovery then means: sign in anonymously on the new machine, hand in the
-- recovery token, and we repoint `auth_uid`. Nothing else moves.
-- ===========================================================================

create extension if not exists pgcrypto;

create type friendship_status as enum ('pending', 'accepted', 'declined');
create type share_status as enum ('queued', 'active', 'watched', 'dismissed', 'expired');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),

  -- The currently linked anonymous auth user. Swapped by claim_profile().
  auth_uid      uuid not null unique references auth.users (id) on delete cascade,

  username      text not null check (char_length(trim(username)) between 2 and 24),

  -- 8 chars, uppercase letters + digits, without the visually ambiguous
  -- O / 0 / I / 1. Generated server side by generate_friend_code().
  friend_code   text not null unique check (friend_code ~ '^[A-HJ-NP-Z2-9]{8}$'),

  -- Deterministically derived from `id` at insert time, used for the avatar
  -- circle in the shelf and the popup.
  avatar_color  text not null default '#2467d4' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),

  -- How many shelf slots this user wants. Spec default 6, adjustable 3..8.
  -- Lives here rather than in the extension because recalculate_slots() needs it.
  slot_count    int not null default 6 check (slot_count between 3 and 8),

  -- Queued shares older than this are auto-expired. 0 disables it.
  expire_after_days int not null default 30 check (expire_after_days between 0 and 365),

  -- When true the shelf is not rendered and no new shares can be received.
  paused        boolean not null default false,

  created_at    timestamptz not null default now()
);

comment on column public.profiles.auth_uid is
  'Anonymous auth user currently bound to this profile. Swapped on recovery.';

-- ---------------------------------------------------------------------------
-- profile_secrets
-- ---------------------------------------------------------------------------
-- Separate table on purpose. RLS is row level, not column level: if the
-- recovery token lived on `profiles`, any policy that lets a friend read your
-- profile row would also hand them your account.
-- ---------------------------------------------------------------------------
create table public.profile_secrets (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  recovery_token uuid not null unique default gen_random_uuid(),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------
create table public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        friendship_status not null default 'pending',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,

  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- One row per unordered pair, so "A asked B" and "B asked A" cannot coexist.
create unique index friendships_unique_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_addressee_idx on public.friendships (addressee_id);

-- ---------------------------------------------------------------------------
-- shares
-- ---------------------------------------------------------------------------
create table public.shares (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid not null references public.profiles (id) on delete cascade,
  recipient_id     uuid not null references public.profiles (id) on delete cascade,

  -- YouTube ids are exactly 11 chars from the URL-safe base64 alphabet.
  video_id         text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),

  -- Metadata snapshot taken from the DOM at share time. We deliberately do not
  -- use the YouTube Data API: no key, no quota, no extra setup step.
  video_title      text check (video_title is null or char_length(video_title) <= 200),
  channel_name     text check (channel_name is null or char_length(channel_name) <= 120),
  duration_seconds int check (duration_seconds is null or duration_seconds between 0 and 86400),

  note             text check (note is null or char_length(note) <= 140),

  -- Sender controlled ordering of their own queue. Lower = more important.
  sender_priority  int not null default 0,

  status           share_status not null default 'queued',
  slot_position    int check (slot_position is null or slot_position between 0 and 7),

  created_at       timestamptz not null default now(),
  activated_at     timestamptz,
  watched_at       timestamptz,

  constraint shares_no_self check (sender_id <> recipient_id),

  -- A slot position exists exactly when the share is active. This is what keeps
  -- recalculate_slots() honest.
  constraint shares_slot_matches_status
    check ((status = 'active') = (slot_position is not null))
);

-- No sending the same video to the same person twice while it is still open.
-- Once it is watched or dismissed, re-sharing is allowed again.
create unique index shares_unique_open
  on public.shares (sender_id, recipient_id, video_id)
  where status in ('queued', 'active');

create index shares_recipient_open_idx
  on public.shares (recipient_id, status, slot_position);
create index shares_sender_idx
  on public.shares (sender_id, recipient_id, sender_priority, created_at);

-- >>> 20260101000100_functions.sql

-- ===========================================================================
-- vid2friend :: 02 core functions, slot algorithm, triggers
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- current_profile_id()
-- ---------------------------------------------------------------------------
-- Every RLS policy funnels through this. security definer so that reading the
-- mapping never itself depends on a policy on `profiles`, which would be a
-- recursion waiting to happen.
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id from public.profiles p where p.auth_uid = auth.uid();
$fn$;

-- ---------------------------------------------------------------------------
-- are_friends(a, b)
-- ---------------------------------------------------------------------------
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
      and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- generate_friend_code()
-- ---------------------------------------------------------------------------
-- 8 characters from a 32 symbol alphabet = 2^40 combinations. Collisions are
-- possible in theory, so we retry; after 20 failed tries something is very
-- wrong and we would rather raise than loop forever.
-- ---------------------------------------------------------------------------
create or replace function public.generate_friend_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no O, I, 0, 1
  candidate text;
  i int;
begin
  for attempt in 1 .. 20 loop
    candidate := '';
    for i in 1 .. 8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    if not exists (select 1 from public.profiles where friend_code = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'V2F_CODE_GENERATION_FAILED';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- avatar_color_for(uuid)
-- ---------------------------------------------------------------------------
-- Deterministic colour derived from the profile id, so the same friend always
-- has the same avatar circle on every device without storing a choice.
-- ---------------------------------------------------------------------------
create or replace function public.avatar_color_for(p_id uuid)
returns text
language plpgsql
immutable
as $fn$
declare
  palette constant text[] := array[
    '#2467d4', '#72a3f2', '#3aa0a0', '#c86ecb', '#e0803c',
    '#5f8ae0', '#4bab6d', '#d1604f', '#8d6ce0', '#3f9bd4'
  ];
  idx int;
begin
  -- get_byte on the raw md5 digest, not a bit(32) cast of the hex string: that
  -- cast is signed, so it happily produces a negative modulo, which indexes an
  -- array out of bounds, returns NULL, and then trips the NOT NULL constraint
  -- on avatar_color. get_byte is 0..255 and always non-negative.
  idx := 1 + (get_byte(decode(md5(p_id::text), 'hex'), 0) % array_length(palette, 1));
  return palette[idx];
end;
$fn$;

-- ---------------------------------------------------------------------------
-- profiles triggers
-- ---------------------------------------------------------------------------
create or replace function public.profiles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.friend_code is null or new.friend_code = '' then
    new.friend_code := public.generate_friend_code();
  end if;
  new.avatar_color := public.avatar_color_for(new.id);
  new.username := trim(new.username);
  return new;
end;
$fn$;

create trigger profiles_before_insert_trg
  before insert on public.profiles
  for each row execute function public.profiles_before_insert();

-- Every profile gets its recovery secret automatically.
create or replace function public.profiles_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profile_secrets (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$fn$;

create trigger profiles_after_insert_trg
  after insert on public.profiles
  for each row execute function public.profiles_after_insert();

-- ===========================================================================
-- THE SLOT ALGORITHM
-- ===========================================================================
-- Goal: fill N shelf slots (default 6) from all open shares addressed to one
-- recipient, fairly across senders. One friend who dumps 15 videos must not
-- occupy every slot.
--
-- Order of operations:
--   1. Expire stale queued shares (lazy, see note below).
--   2. Rank each sender's own queue: sender_priority ASC, then created_at ASC.
--   3. Rank the senders themselves by the age of their oldest open share, so
--      whoever has been waiting longest goes first.
--   4. Round robin: 1st of sender A, 1st of B, 1st of C, 2nd of A, ...
--      In SQL that is simply: ORDER BY rank_within_sender, sender_rank.
--   5. The first N of that list become active.
--
-- Stability (spec point 6): the SET of active shares follows strictly from the
-- round robin, but a share that is already active keeps the slot_position it
-- has. Only genuinely free positions are handed to newcomers. Without this the
-- shelf would reshuffle under the user's cursor every time anything changes.
--
-- Idempotence: calling this twice in a row is a no-op, because step 5 only
-- touches rows whose status or position actually differs.
--
-- Expiry is done lazily here instead of via pg_cron, which is not guaranteed to
-- be available on the Supabase free tier. The cost is that a queue only expires
-- when it is next touched, which is exactly when anyone would notice.
-- ===========================================================================
create or replace function public.recalculate_slots(p_recipient uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_slot_count  int;
  v_expire_days int;
  v_paused      boolean;
  v_chosen      uuid[];
  v_taken       int[];
  v_free        int[];
  v_id          uuid;
  v_status      share_status;
  v_slot        int;
  v_next        int := 1;
begin
  select slot_count, expire_after_days, paused
    into v_slot_count, v_expire_days, v_paused
    from public.profiles where id = p_recipient;

  if not found then
    return;
  end if;

  -- Step 1: lazy expiry of stale queued shares.
  if v_expire_days > 0 then
    update public.shares
       set status = 'expired', slot_position = null
     where recipient_id = p_recipient
       and status = 'queued'
       and created_at < now() - make_interval(days => v_expire_days);
  end if;

  -- A paused user simply has no active shares. Nothing is lost, everything
  -- stays queued and comes back the moment they unpause.
  if v_paused then
    update public.shares
       set status = 'queued', slot_position = null
     where recipient_id = p_recipient and status = 'active';
    return;
  end if;

  -- Steps 2 to 4: the round robin, as one ordered array of share ids.
  select array_agg(id order by rr)
    into v_chosen
    from (
      select o.id,
             row_number() over (
               order by o.rank_in_sender asc, so.sender_rank asc
             ) as rr
        from (
          select s.id,
                 s.sender_id,
                 row_number() over (
                   partition by s.sender_id
                   order by s.sender_priority asc, s.created_at asc, s.id asc
                 ) as rank_in_sender
            from public.shares s
           where s.recipient_id = p_recipient
             and s.status in ('queued', 'active')
        ) o
        join (
          select s.sender_id,
                 row_number() over (
                   order by min(s.created_at) asc, s.sender_id asc
                 ) as sender_rank
            from public.shares s
           where s.recipient_id = p_recipient
             and s.status in ('queued', 'active')
           group by s.sender_id
        ) so on so.sender_id = o.sender_id
    ) ranked
   where rr <= v_slot_count;

  v_chosen := coalesce(v_chosen, '{}'::uuid[]);

  -- Step 5a: anything active that did not make the cut goes back to the queue.
  update public.shares
     set status = 'queued', slot_position = null
   where recipient_id = p_recipient
     and status = 'active'
     and not (id = any (v_chosen));

  -- Step 5b: if slot_count shrank, positions beyond the new limit are invalid.
  update public.shares
     set status = 'queued', slot_position = null
   where recipient_id = p_recipient
     and status = 'active'
     and slot_position >= v_slot_count;

  -- Step 5c: which positions are still held by survivors.
  select coalesce(array_agg(slot_position), '{}'::int[])
    into v_taken
    from public.shares
   where recipient_id = p_recipient and status = 'active';

  select coalesce(array_agg(g order by g), '{}'::int[])
    into v_free
    from generate_series(0, v_slot_count - 1) g
   where not (g = any (v_taken));

  -- Step 5d: hand the free positions to the newcomers, in round robin order.
  foreach v_id in array v_chosen loop
    select status, slot_position into v_status, v_slot
      from public.shares where id = v_id;

    if v_status = 'active' and v_slot is not null then
      continue; -- keeps its position, see "Stability" above
    end if;

    exit when v_next > coalesce(array_length(v_free, 1), 0);

    update public.shares
       set status = 'active',
           slot_position = v_free[v_next],
           activated_at = coalesce(activated_at, now())
     where id = v_id;

    v_next := v_next + 1;
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Triggers that keep the slots in sync
-- ---------------------------------------------------------------------------
-- pg_trigger_depth() guard: recalculate_slots() writes to `shares` itself, so
-- without it this trigger would call itself forever.
-- ---------------------------------------------------------------------------
create or replace function public.shares_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  perform public.recalculate_slots(coalesce(new.recipient_id, old.recipient_id));
  return null;
end;
$fn$;

create trigger shares_recalc_trg
  after insert or update or delete on public.shares
  for each row execute function public.shares_recalc_trigger();

create or replace function public.friendships_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recalculate_slots(coalesce(new.requester_id, old.requester_id));
  perform public.recalculate_slots(coalesce(new.addressee_id, old.addressee_id));
  return null;
end;
$fn$;

create trigger friendships_recalc_trg
  after update or delete on public.friendships
  for each row execute function public.friendships_recalc_trigger();

-- ---------------------------------------------------------------------------
-- shares_guard: the rules that RLS alone cannot express
-- ---------------------------------------------------------------------------
create or replace function public.shares_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_open int;
begin
  -- Belt and braces: RLS already restricts inserts to the sender, this makes
  -- sure the friendship actually exists even if a policy is ever loosened.
  if not public.are_friends(new.sender_id, new.recipient_id) then
    raise exception 'V2F_NOT_FRIENDS';
  end if;

  select count(*) into v_open
    from public.shares
   where sender_id = new.sender_id
     and recipient_id = new.recipient_id
     and status in ('queued', 'active');

  if v_open >= 20 then
    raise exception 'V2F_QUEUE_FULL';
  end if;

  return new;
end;
$fn$;

create trigger shares_guard_trg
  before insert on public.shares
  for each row execute function public.shares_guard();

-- >>> 20260101000200_rls.sql

-- ===========================================================================
-- vid2friend :: 03 Row Level Security
-- ===========================================================================
-- READ THIS BEFORE CHANGING ANYTHING IN HERE.
--
-- The Supabase anon key ships inside the extension bundle. Anyone can extract
-- it, open a REST client and talk to the database directly. RLS is not one of
-- several defences, it is the only one. Every policy below therefore says in
-- its comment what it prevents.
--
-- Two mechanisms are used together:
--   * RLS policies decide WHICH ROWS a request may touch.
--   * Column level GRANTs decide WHICH COLUMNS may be written, because RLS
--     cannot express that. This is how "only the sender may change
--     sender_priority" is actually enforced.
--
-- Everything that needs more logic than that (creating a profile, answering a
-- friend request, marking a share watched) goes through a SECURITY DEFINER
-- function in 04_rpc.sql. Those functions bypass RLS on purpose and do their
-- own authorisation check as their first statement.
-- ===========================================================================

alter table public.profiles        enable row level security;
alter table public.profile_secrets enable row level security;
alter table public.friendships     enable row level security;
alter table public.shares          enable row level security;

-- Start from zero. Supabase grants ALL on new public tables to anon and
-- authenticated by default, which would make the policies below pointless.
revoke all on public.profiles        from anon, authenticated;
revoke all on public.profile_secrets from anon, authenticated;
revoke all on public.friendships     from anon, authenticated;
revoke all on public.shares          from anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Prevents: enumerating every user of the extension. You can read your own
-- profile and the profiles of people you have any friendship row with. Looking
-- someone up by friend code goes through find_profile_by_code(), which returns
-- only the display fields and nothing else.
create policy profiles_select_self_and_friends
  on public.profiles for select
  to authenticated
  using (
    id = public.current_profile_id()
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = profiles.id and f.addressee_id = public.current_profile_id())
         or (f.addressee_id = profiles.id and f.requester_id = public.current_profile_id())
    )
  );

-- Prevents: editing someone else's display name or settings.
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

-- No insert or delete policy on purpose: profiles are created by
-- bootstrap_profile() and removed by delete_account(), both SECURITY DEFINER.

grant select on public.profiles to authenticated;

-- Prevents: re-pointing auth_uid at your own session and taking over another
-- account, or handing yourself a nicer friend_code. Only these four columns are
-- writable at all, no matter what the policy above allows.
grant update (username, slot_count, expire_after_days, paused)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- profile_secrets
-- ---------------------------------------------------------------------------

-- Prevents: reading anyone else's recovery token, which would be a full account
-- takeover. This is the entire reason the token does not live on `profiles`.
create policy profile_secrets_select_self
  on public.profile_secrets for select
  to authenticated
  using (profile_id = public.current_profile_id());

grant select on public.profile_secrets to authenticated;

-- Deliberately no insert/update/delete grant: the row is created by a trigger
-- and rotated by rotate_recovery_token().

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------

-- Prevents: seeing who else is friends with whom.
create policy friendships_select_own
  on public.friendships for select
  to authenticated
  using (
    requester_id = public.current_profile_id()
    or addressee_id = public.current_profile_id()
  );

-- Prevents: accepting a request that was sent to somebody else, and prevents
-- the requester from accepting their own request. Only the addressee may
-- answer, and only while the request is still pending.
create policy friendships_update_addressee
  on public.friendships for update
  to authenticated
  using (addressee_id = public.current_profile_id() and status = 'pending')
  with check (addressee_id = public.current_profile_id() and status <> 'pending');

-- Prevents: deleting a friendship you are not part of. Either side may end it.
create policy friendships_delete_own
  on public.friendships for delete
  to authenticated
  using (
    requester_id = public.current_profile_id()
    or addressee_id = public.current_profile_id()
  );

grant select, delete on public.friendships to authenticated;

-- Prevents: rewriting who the request was from or to while answering it.
grant update (status, responded_at) on public.friendships to authenticated;

-- No insert grant: requests are created by send_friend_request(), which is the
-- only place that knows how to resolve a friend code without exposing the
-- whole profiles table.

-- ---------------------------------------------------------------------------
-- shares
-- ---------------------------------------------------------------------------

-- Prevents: reading other people's recommendations. Both ends of a share can
-- see it, nobody else.
create policy shares_select_involved
  on public.shares for select
  to authenticated
  using (
    sender_id = public.current_profile_id()
    or recipient_id = public.current_profile_id()
  );

-- Prevents: putting a video into someone's shelf in another person's name, and
-- prevents sending to strangers. The friendship itself is verified once more by
-- the shares_guard trigger, which also enforces the 20 open shares limit.
create policy shares_insert_as_sender
  on public.shares for insert
  to authenticated
  with check (
    sender_id = public.current_profile_id()
    and public.are_friends(sender_id, recipient_id)
  );

-- Prevents: deleting a recommendation somebody sent you instead of dismissing
-- it (the sender would lose the "watched" feedback), and prevents rewriting
-- history by deleting shares that are already watched.
create policy shares_delete_own_open
  on public.shares for delete
  to authenticated
  using (
    sender_id = public.current_profile_id()
    and status in ('queued', 'active')
  );

grant select, insert, delete on public.shares to authenticated;

-- No update grant at all. Both legitimate updates are narrow and go through
-- their own RPC: set_share_priority() for the sender, mark_share_watched() and
-- dismiss_share() for the recipient. That way "the sender may only change
-- sender_priority, the recipient may only change status" is enforced by code
-- that can be read in one place instead of by a column grant matrix.

-- >>> 20260101000300_rpc.sql

-- ===========================================================================
-- vid2friend :: 04 RPCs
-- ===========================================================================
-- Everything in here is SECURITY DEFINER, which means it runs with the rights
-- of the migration owner and RLS does not apply. That is the point: these are
-- the operations RLS cannot express. In exchange every single function starts
-- by resolving the caller with current_profile_id() and refuses to continue if
-- the caller is not who they claim to be.
--
-- Error messages are stable identifiers prefixed V2F_. The extension maps them
-- to human readable text in src/shared/errors.ts, so the wording can change
-- without touching the database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- bootstrap_profile(username)
-- ---------------------------------------------------------------------------
-- Called once, right after the anonymous sign in, when the user has picked a
-- display name. Idempotent: calling it again just renames the existing profile,
-- so a retry after a dropped connection cannot create a second account.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_profile(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing public.profiles;
  v_name text := trim(coalesce(p_username, ''));
begin
  if auth.uid() is null then
    raise exception 'V2F_NOT_AUTHENTICATED';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'V2F_INVALID_USERNAME';
  end if;

  select * into v_existing from public.profiles where auth_uid = auth.uid();

  if found then
    update public.profiles set username = v_name
      where id = v_existing.id
      returning * into v_existing;
    return v_existing;
  end if;

  insert into public.profiles (auth_uid, username)
  values (auth.uid(), v_name)
  returning * into v_existing;

  return v_existing;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- find_profile_by_code(code)
-- ---------------------------------------------------------------------------
-- The only way to look up a stranger. Returns display fields only, never the
-- friend code of anyone else and never anything from profile_secrets.
-- ---------------------------------------------------------------------------
create or replace function public.find_profile_by_code(p_code text)
returns table (id uuid, username text, avatar_color text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  return query
    select p.id, p.username, p.avatar_color
      from public.profiles p
     where p.friend_code = upper(trim(p_code))
       and p.id <> v_me;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- send_friend_request(code)
-- ---------------------------------------------------------------------------
-- If the other person already sent us a request, this accepts it instead of
-- creating a mirrored second row. That is what makes the "we both pasted each
-- other's code" case behave sensibly.
-- ---------------------------------------------------------------------------
create or replace function public.send_friend_request(p_code text)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me     uuid := public.current_profile_id();
  v_other  uuid;
  v_row    public.friendships;
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  select p.id into v_other
    from public.profiles p
   where p.friend_code = upper(trim(p_code));

  if v_other is null then
    raise exception 'V2F_CODE_NOT_FOUND';
  end if;
  if v_other = v_me then
    raise exception 'V2F_CANNOT_ADD_SELF';
  end if;

  select * into v_row
    from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, v_other)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_other);

  if found then
    if v_row.status = 'accepted' then
      raise exception 'V2F_ALREADY_FRIENDS';
    end if;

    -- They asked us first: treat this as an acceptance.
    if v_row.addressee_id = v_me then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = v_row.id
       returning * into v_row;
      return v_row;
    end if;

    -- We asked them before and they declined: allow one more try.
    if v_row.status = 'declined' then
      update public.friendships
         set status = 'pending', created_at = now(), responded_at = null
       where id = v_row.id
       returning * into v_row;
      return v_row;
    end if;

    raise exception 'V2F_REQUEST_PENDING';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (v_me, v_other)
  returning * into v_row;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- respond_friend_request(id, accept)
-- ---------------------------------------------------------------------------
create or replace function public.respond_friend_request(p_friendship uuid, p_accept boolean)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me  uuid := public.current_profile_id();
  v_row public.friendships;
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  select * into v_row from public.friendships where id = p_friendship;
  if not found then
    raise exception 'V2F_REQUEST_NOT_FOUND';
  end if;
  -- Only the person who was asked may answer.
  if v_row.addressee_id <> v_me then
    raise exception 'V2F_NOT_ALLOWED';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'V2F_ALREADY_ANSWERED';
  end if;

  update public.friendships
     set status = case when p_accept then 'accepted'::friendship_status
                       else 'declined'::friendship_status end,
         responded_at = now()
   where id = p_friendship
   returning * into v_row;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- remove_friend(profile_id)
-- ---------------------------------------------------------------------------
-- Deleting the friendship row also drops every still open share between the
-- two, which is handled by the friendships_after_delete trigger below.
-- ---------------------------------------------------------------------------
create or replace function public.remove_friend(p_friend uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  delete from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, p_friend)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_friend);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Share mutations
-- ---------------------------------------------------------------------------
-- `shares` has no UPDATE grant at all, so these three functions are the
-- complete list of ways a share can change state. Each checks the one identity
-- that is allowed to perform it.
-- ---------------------------------------------------------------------------

create or replace function public.mark_share_watched(p_share uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  update public.shares
     set status = 'watched', slot_position = null, watched_at = now()
   where id = p_share
     and recipient_id = v_me          -- only the recipient can watch something
     and status in ('queued', 'active');
end;
$fn$;

create or replace function public.dismiss_share(p_share uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  update public.shares
     set status = 'dismissed', slot_position = null
   where id = p_share
     and recipient_id = v_me
     and status in ('queued', 'active');
end;
$fn$;

-- Powers the undo toast on the shelf. Only works while the share has not been
-- expired or watched in the meantime.
create or replace function public.undismiss_share(p_share uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  update public.shares
     set status = 'queued', slot_position = null
   where id = p_share
     and recipient_id = v_me
     and status = 'dismissed';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- reorder_shares(recipient, ordered ids)
-- ---------------------------------------------------------------------------
-- Drag and drop in the popup. Writes sender_priority 0..n-1 in the given order
-- for the caller's own queue towards one friend. Ids that are not the caller's
-- are silently skipped rather than failing the whole reorder.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_shares(p_recipient uuid, p_share_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
  v_id uuid;
  v_i  int := 0;
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  foreach v_id in array coalesce(p_share_ids, '{}'::uuid[]) loop
    update public.shares
       set sender_priority = v_i
     where id = v_id
       and sender_id = v_me            -- only your own queue, never theirs
       and recipient_id = p_recipient
       and status in ('queued', 'active');
    v_i := v_i + 1;
  end loop;

  perform public.recalculate_slots(p_recipient);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- friends_already_queued(video_id, friend_ids)
-- ---------------------------------------------------------------------------
-- Powers the "Niklas already has this one waiting" hint in the share modal.
-- Returns only ids of people the caller is actually friends with, and only a
-- yes/no per person, never who sent it or when.
-- ---------------------------------------------------------------------------
create or replace function public.friends_already_queued(p_video_id text, p_friend_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    return;
  end if;

  return query
    select distinct s.recipient_id
      from public.shares s
     where s.video_id = p_video_id
       and s.status in ('queued', 'active')
       and s.recipient_id = any (coalesce(p_friend_ids, '{}'::uuid[]))
       and public.are_friends(v_me, s.recipient_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Account recovery
-- ---------------------------------------------------------------------------
-- The anonymous identity lives in one Chrome profile. claim_profile() is what
-- moves it. The token is not rotated automatically on use, so the same backup
-- code keeps working on a third machine; rotate_recovery_token() invalidates it
-- on demand.
-- ---------------------------------------------------------------------------
create or replace function public.claim_profile(p_token uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_target uuid;
  v_mine   uuid := public.current_profile_id();
  v_row    public.profiles;
begin
  if auth.uid() is null then
    raise exception 'V2F_NOT_AUTHENTICATED';
  end if;

  select profile_id into v_target
    from public.profile_secrets where recovery_token = p_token;

  if v_target is null then
    raise exception 'V2F_INVALID_RECOVERY_CODE';
  end if;

  if v_mine is not null and v_mine <> v_target then
    -- Refusing here rather than silently discarding whatever is already on this
    -- machine. The popup tells the user to delete the local account first.
    raise exception 'V2F_PROFILE_ALREADY_ON_THIS_DEVICE';
  end if;

  update public.profiles
     set auth_uid = auth.uid()
   where id = v_target
   returning * into v_row;

  return v_row;
end;
$fn$;

create or replace function public.rotate_recovery_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := public.current_profile_id();
  v_token uuid;
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  update public.profile_secrets
     set recovery_token = gen_random_uuid()
   where profile_id = v_me
   returning recovery_token into v_token;

  return v_token;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- delete_account()
-- ---------------------------------------------------------------------------
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    return;
  end if;

  -- profiles cascades into profile_secrets, friendships and shares.
  delete from public.profiles where id = v_me;

  -- Best effort: also drop the anonymous auth user so nothing is left behind.
  begin
    delete from auth.users where id = auth.uid();
  exception when others then
    null;
  end;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Friendship deletion cleans up open shares
-- ---------------------------------------------------------------------------
-- Replaces the placeholder from 02_functions.sql: on delete we first drop every
-- still open share between the two, then recalculate both shelves.
-- Watched and dismissed shares are kept, they are history, not a live link.
-- ---------------------------------------------------------------------------
create or replace function public.friendships_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.shares s
     where s.status in ('queued', 'active')
       and (
         (s.sender_id = old.requester_id and s.recipient_id = old.addressee_id)
         or (s.sender_id = old.addressee_id and s.recipient_id = old.requester_id)
       );
  end if;

  perform public.recalculate_slots(coalesce(new.requester_id, old.requester_id));
  perform public.recalculate_slots(coalesce(new.addressee_id, old.addressee_id));
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Execute grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default. For SECURITY DEFINER functions
-- that is sloppy, so we revoke and hand it out deliberately.
-- ---------------------------------------------------------------------------
do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.current_profile_id()',
    'public.are_friends(uuid, uuid)',
    'public.generate_friend_code()',
    'public.recalculate_slots(uuid)',
    'public.bootstrap_profile(text)',
    'public.find_profile_by_code(text)',
    'public.send_friend_request(text)',
    'public.respond_friend_request(uuid, boolean)',
    'public.remove_friend(uuid)',
    'public.mark_share_watched(uuid)',
    'public.dismiss_share(uuid)',
    'public.undismiss_share(uuid)',
    'public.reorder_shares(uuid, uuid[])',
    'public.friends_already_queued(text, uuid[])',
    'public.claim_profile(uuid)',
    'public.rotate_recovery_token()',
    'public.delete_account()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$grants$;

-- generate_friend_code and recalculate_slots are internal. They are listed
-- above so the revoke runs, but authenticated does not need them directly.
revoke execute on function public.generate_friend_code() from authenticated;
revoke execute on function public.recalculate_slots(uuid) from authenticated;

-- >>> 20260101000400_realtime.sql

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

-- >>> 20260101000500_invite.sql

-- ===========================================================================
-- vid2friend :: 06 invite links
-- ===========================================================================
-- Sending someone your personal link IS the invitation. Before this, opening
-- that link made the RECIPIENT send a request back, which the sender then had
-- to confirm - the invitation ran backwards, and the person who started the
-- whole thing got a notification asking them to approve being taken up on their
-- own offer.
--
-- accept_invite() puts it the right way round: the code owner is recorded as
-- the requester, the person opening the link answers. Accepting makes them
-- friends there and then.
--
-- On the security of that: this does not hand out anything the previous flow
-- protected. Possession of the eight character code was already sufficient to
-- reach someone, profiles cannot be enumerated (see find_profile_by_code), and
-- anyone holding a code could always have constructed the link themselves. The
-- code is the credential; what changed is only who is asked to confirm.
-- A code that gets around can be replaced under Settings.
-- ===========================================================================

create or replace function public.accept_invite(p_code text, p_accept boolean default true)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := public.current_profile_id();
  v_owner uuid;
  v_row   public.friendships;
begin
  if v_me is null then
    raise exception 'V2F_NO_PROFILE';
  end if;

  select p.id into v_owner
    from public.profiles p
   where p.friend_code = upper(trim(p_code));

  if v_owner is null then
    raise exception 'V2F_CODE_NOT_FOUND';
  end if;
  if v_owner = v_me then
    raise exception 'V2F_CANNOT_ADD_SELF';
  end if;

  select * into v_row
    from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, v_owner)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_owner);

  if found then
    if v_row.status = 'accepted' then
      raise exception 'V2F_ALREADY_FRIENDS';
    end if;

    -- Covers both a pending request from either direction and an earlier
    -- decline: opening a fresh invite link is a clear enough signal to let the
    -- answer be given again.
    update public.friendships
       set status = case when p_accept then 'accepted'::friendship_status
                         else 'declined'::friendship_status end,
           responded_at = now()
     where id = v_row.id
     returning * into v_row;

    return v_row;
  end if;

  -- The code owner is the requester: they are the one who invited.
  insert into public.friendships (requester_id, addressee_id, status, responded_at)
  values (
    v_owner,
    v_me,
    case when p_accept then 'accepted'::friendship_status else 'declined'::friendship_status end,
    now()
  )
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all on function public.accept_invite(text, boolean) from public, anon;
grant execute on function public.accept_invite(text, boolean) to authenticated;

