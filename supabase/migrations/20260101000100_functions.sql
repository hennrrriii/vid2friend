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
