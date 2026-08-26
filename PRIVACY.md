# Privacy Policy for vid2friend

_Last updated: 26 August 2026_

vid2friend is a Chrome extension that lets you send YouTube videos to friends.
This policy describes exactly what it stores and why. It is short because the
extension collects very little.

## What is stored

When you set up vid2friend, the following is stored on our Supabase database:

| Data | Why |
|---|---|
| A display name you choose | So your friends can see who recommended a video |
| A generated 8 character friend code | So friends can find you without an email address |
| An anonymous account id | So the server can tell your data apart from someone else's |
| A backup code | So you can move your account to another computer |
| Your friend list | So we know who you are allowed to share with |
| For each shared video: the YouTube video id, its title, channel name and length, an optional note you write, and whether it has been watched | This is the recommendation itself |
| Your settings: number of slots, expiry period, paused | So they apply on every computer you use |

Stored locally in your browser (`chrome.storage.local`), never sent anywhere:

- Your login session token
- A cached copy of your current recommendations, so the row on the YouTube
  homepage appears instantly

## What is NOT collected

- **No email address, no password, no name, no phone number.** Sign in is
  anonymous. We never ask for and never receive an identity.
- **No browsing history.** The extension only ever records videos you actively
  choose to share. It does not observe, log or transmit what you watch.
- **No analytics, no tracking pixels, no advertising, no third party
  trackers.** There is no telemetry of any kind.
- **No payment data.** The extension is free.
- **No data from any website other than youtube.com.** The extension has
  permission for youtube.com only.

## Watch detection

When you open a video that a friend recommended, the extension counts how much
of it you have played, in your browser only. Once you have seen 60% of it or
three minutes, whichever comes first, it marks that one recommendation as
watched so it leaves your row and your friend can see you watched it. Nothing
about any other video is recorded, and no playback position is transmitted.

## Who can see your data

- **Your friends** see your display name, and for videos you sent them: the
  video, your note and whether they have watched it.
- **Nobody else.** The database uses PostgreSQL Row Level Security, which
  enforces per-row access at the database level. A user can only read their own
  profile, the profiles of people they have a friendship with, and the shares
  they sent or received.
- **We do not sell, rent or share data with third parties.** There are no third
  parties.

## Where the data is stored

On [Supabase](https://supabase.com) (PostgreSQL), hosted in the EU
(`eu-central-1`, Frankfurt). Supabase acts as a data processor.

Video thumbnails are loaded directly from `i.ytimg.com`, Google's thumbnail
server, in the same way YouTube itself loads them.

## How long it is kept

- Unwatched recommendations are deleted automatically after 30 days by default.
  You can change this to 14 or 90 days, or switch it off, in the extension
  settings.
- Everything else is kept until you delete it.

## Deleting your data

Open the extension, go to **Settings**, and use **Delete my account**. This
removes your profile, your friendships and every recommendation you sent or
received, immediately and permanently. Uninstalling the extension without doing
this leaves the server side data in place.

## Permissions the extension requests

| Permission | Why it is needed |
|---|---|
| `storage` | Store your login session and the cached recommendations locally |
| `alarms` | Check for new recommendations every five minutes |
| `https://*.youtube.com/*` | Add the recommendation row, the menu entry and the share button to YouTube pages |
| The Supabase project URL | Talk to the database |

The extension deliberately does **not** request the `tabs` permission or access
to any site other than YouTube.

## Children

vid2friend is not directed at children under 13 and does not knowingly collect
data from them.

## Changes

If this policy changes, the updated version will be published in the extension's
GitHub repository and the date at the top will be updated.

## Contact

Questions or a deletion request that the in-app button cannot handle:
open an issue at <https://github.com/hennrrriii/vid2friend/issues>.
