# Phase 13 report — Friends, chat, profiles and moderation

**Date:** 2026-10-13 · **Result:** complete.

What members can now do:
- **Friends:** find each other by username (never by e-mail), send and accept friend requests, block and unblock, and invite friends straight into a lobby. Friends persist across rooms.
- **Chat:** chat in every room. Auction teams also get a private 🔒 Team channel next to the public one.
- **Profiles:** edit their own profile, with a privacy level and a picture, and see their medals, which are read-only.
- **Inbox:** an inbox for invitations and friend updates.

Every rule is enforced by the server. Team chat travels on the team's existing realtime stream, so opponents and former members can neither read it live nor replay it. Decisions are recorded in ADR-028.

## Migration
- **`100_social_chat`:**
  - `chat_channels` (room/team), `chat_messages` (1–500 code points, idempotent per sender and client id, removal fields) and `chat_mutes` (at most 24 h). All cascade from the room, so chat is temporary.
  - Lookup indexes for friendships and invites; FORCE RLS on the new tables.
  - The franchise captain foreign key is now deferred to commit, so deleting a room with franchises works.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `100_social_chat`, and the manifest is updated.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Contracts:**
  - `packages/contracts/src/chat.ts`: `ChatText` (code points), command payloads and acks, event payloads, `ChatChannelDTO`.
  - `packages/contracts/src/social.ts`: `ProfileDTO`, patch, avatar upload, friends, search, invites, inbox.
  - Catalogs updated (`ProfileDTO`, `FriendsViewDTO`, `NotificationsViewDTO`, `ChatChannelDTO`, `GET /v1/blocks`, invite accept, chat errors).
- **Server:**
  - `modules/chat/{channels,commands,index}.ts`: `chat.send/remove/mute/subscribe/unsubscribe` through the room transaction wrapper, and the history route `GET /v1/rooms/:id/chat/:channel/messages`.
  - `modules/social/{relations,notifications,profiles,friends}.ts` and `routes/v1/social.ts`: profiles, avatar, search, friends, blocks, inbox, room invites and invite acceptance.
  - `rooms/service.ts`: join by room id, used by invite acceptance.
  - `media/service.ts`: serves current avatars through the private media proxy.
  - Avatar body limit raised to 2 MiB of image on the API and the BFF.
- **Web:**
  - `features/chat/{ChatPanel,ChatDrawer,ChatPage}.tsx`; the drawer appears in the lobby and auction setup screens, the auction stage and the card arena; pages `/rooms/[id]/chat/{public,team}`.
  - `features/room/connection.ts` gains `listen()`; `events.ts` applies chat events without a snapshot refetch.
  - `features/social/{Avatar,ProfileView,FriendsPage,NotificationsPage}.tsx` and pages `/players/[username]` (S29), `/friends` (S30) and `/notifications` (S31).
  - The shell gains Friends, Inbox (with unread count) and a profile link. The lobby gains "Invite friends", and the dashboard friends strip links to `/friends`.
- **Tests:**
  - `tests/integration/chat.spec.ts` (3)
  - `tests/integration/social.spec.ts` (7)
  - `tests/security/chat-acl.spec.ts` (2)
  - `tests/e2e/social.spec.ts` (2)
  - New unit cases in `packages/contracts/test/contracts.spec.ts` (code points) and `apps/web/test/room-events.spec.ts` (chat events).

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 67 error codes, 88 HTTP operations |
| `pnpm test:unit` | ✅ 219 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 17 migrations / 69 tables |
| `pnpm test:integration` | ✅ 129 |
| `pnpm test:security` | ✅ 46 |
| `pnpm test:concurrency` | ✅ 12 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 40 passed, 8 skipped (two-context flows run once, on desktop) |

## Verified behaviour
- **Team chat privacy:**
  - A rival addressing the host team's channel by id is refused for send, mute and subscribe (`CHAT_FORBIDDEN`) and for remove (404).
  - The rival's history views and the team stream replay (404) never contain the message.
  - A teammate can replay it until they leave the team; then history, sending and replay are refused at once.
  - A member of another room cannot read or post.
- **Message rules:**
  - 500 emoji are accepted and 501 refused.
  - Markup and script text are stored and shown verbatim; in the browser no element is created and no script runs.
  - A repeated `clientMessageId` returns the same message.
- **Moderation:**
  - The sixth message within 10 s gets `RATE_LIMITED` with a retry time.
  - A muted member gets `MUTED` until the expiry.
  - A removed message's text is gone from both history and event replay.
  - Chat rows disappear with the room.
- **Privacy and search:**
  - Members / friends / private visibility applies, and e-mail never appears.
  - Search needs 3 characters, matches usernames only, and hides private and blocked members.
  - Avatars refuse SVG (even with a script inside) and non-images, and stored pictures have no EXIF. The 2 MiB limit is enforced by the schema, the API body limit and the BFF, but no test covers it.
- **Friends and invites:**
  - Duplicate requests are idempotent, only the recipient accepts, and both sides are notified. The pending limit is 20.
  - A block removes the friendship and the pending invite and conceals both profiles; unblocking restores nothing.
  - Only friends can be invited. The invite carries no code or password, the wrong password is refused, and the right one joins the lobby.
- **E2E (two browsers, one at 360 px):** search, request, accept, profile, invite to a passworded room, join from the inbox, then public chat both ways. In an auction, a team message stays on the team tab and never appears for the rival, even after a reload.

## Gaps and notes
- **Achievement gallery (S29):** waits for receipts from finalization (phase 14). Counters are shown now and come from the summary only.
- **Chat reporting to administrators:** phase 16 (S33). Notification filters on S31 are not needed with only three item types.
- **Advisor-level team chat rights:** every approved team member can read and send in the team channel; only the captain moderates it. A per-member chat capability was not required by the spec.
