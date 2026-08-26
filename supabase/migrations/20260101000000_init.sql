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
