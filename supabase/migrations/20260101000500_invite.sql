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
