-- ===========================================================================
-- vid2friend :: seed data
-- ===========================================================================
-- FOR LOCAL DEVELOPMENT ONLY (`supabase start` / `supabase db reset`).
--
-- Do not run this against your hosted project. It writes directly into
-- auth.users, which is fine for a throwaway local stack and a bad idea anywhere
-- else. To try the extension for real, use two Chrome profiles instead - see
-- README section 8.
--
-- Creates: Henri and Niklas, already friends, with five videos waiting for
-- Henri so the round robin and the queue have something to chew on.
-- ===========================================================================

insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, auth_uid, username, friend_code) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Henri',  'HENRI234'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Niklas', 'NIKLAS78')
on conflict (id) do nothing;

insert into public.friendships (requester_id, addressee_id, status, responded_at)
values ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'accepted', now())
on conflict do nothing;

-- Five from Niklas to Henri, staggered in time so the ordering is visible.
insert into public.shares
  (sender_id, recipient_id, video_id, video_title, channel_name, duration_seconds, note, created_at)
values
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'dQw4w9WgXcQ', 'ELEKTRO RIDEOUT ESKALIERT', 'Rideout TV', 743, 'ab Minute 4 wird es wild', now() - interval '5 hours'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'aqz-KE-bpKQ', 'Big Buck Bunny', 'Blender Foundation', 635, null, now() - interval '4 hours'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'jNQXAC9IVRw', 'Me at the zoo', 'jawed', 19, 'das erste YouTube Video ueberhaupt', now() - interval '3 hours'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'ZTUVgYoeN_b', 'Placeholder four', 'Some channel', 300, null, now() - interval '2 hours'),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'M7lc1UVf-VE', 'YouTube Player API', 'Google Developers', 366, null, now() - interval '1 hour')
on conflict do nothing;
