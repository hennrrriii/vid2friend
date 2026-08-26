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
