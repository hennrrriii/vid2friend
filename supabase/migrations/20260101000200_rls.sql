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
