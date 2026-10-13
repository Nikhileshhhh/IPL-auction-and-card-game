# ADR-028: Social features and temporary room/team chat

- **Status:** Accepted (phase 13, 13 October 2026). It implements master plan §§ social and chat, DB/realtime §5.1 (social tables), §7 (social routes), §8 (chat commands and events) and §10 (ProfileDTO), and screens S24, S25 and S29–S31. It builds on ADR-005 (privacy), ADR-008 (state sync and streams) and ADR-026 (team membership).
- **Context:** before this phase:
  - `/players/:username` showed only the viewer's own profile;
  - there were no friends, blocks, inbox or chat;
  - the social tables (`friendships`, `user_blocks`, `notifications`, `room_invites`) existed but no code used them.

  The phase must make friends persist across rooms, keep private team chat unreadable to opponents, and have every social view respect privacy. Three mistakes are named in the spec:
  - hidden UI used as the access check;
  - room chat stored in persistent notifications;
  - medal counts taken from the profile form.

## Decision

### 1. Chat is temporary and lives in the room
- **Tables (migration `100_social_chat`):**
  - `chat_channels`: one `room` channel per room and one `team` channel per franchise. The franchise is set if and only if the kind is `team`. Channels are created on first use.
  - `chat_messages` and `chat_mutes`.
- **Lifetime:** every row cascades from `rooms`, so chat disappears with its room. Chat text is never copied into notifications, profiles or any other persistent table.
- **Text:**
  - Plain text of 1–500 Unicode code points, counted as `[...text].length` in contracts and `char_length` in PostgreSQL, so an emoji counts once.
  - Markup is stored and returned verbatim and rendered as React text only; there is no `dangerouslySetInnerHTML`.
  - Message bodies are never logged.
- **Who sees what:**
  - Card rooms have only the room channel.
  - Auction rooms have the room channel for every member and a team channel for each franchise's approved members.

### 2. Access is enforced by the server, on every path
- **Every read and write checks the channel under the room lock.** History (`GET /v1/rooms/:id/chat/:channel/messages`), `chat.send`, `chat.remove`, `chat.mute` and `chat.subscribe` all re-check the actor's current membership:
  - an unknown channel, another room's channel or another team's channel answers `CHAT_FORBIDDEN`;
  - removing a message the actor can't see answers `NOT_FOUND`.
- **Delivery and replay reuse the existing streams.**
  - A chat event goes on the public stream (room channel) or the franchise's team stream (team channel).
  - Live delivery and cursor replay therefore use the stream ACL from phases 09 and 12.
  - A member removed from a team loses history, sending and replay immediately: the ACL is evaluated on every replay, not cached.
- **The UI never decides access.** The team tab appears only when the server returns a team channel, but hiding it is cosmetic; the security tests call the API directly by channel id.

### 3. Sending, idempotency, rate limits and moderation
- **Sending:**
  - `chat.send` runs through the room transaction wrapper.
  - A retry with the same `clientMessageId` returns the original message, enforced by UQ(sender, client_message_id) and the command receipt.
  - The receipt stores only a body hash and the message id, never the text.
- **Rate limit:** 5 messages per 10 s per member and channel. A sixth gets `RATE_LIMITED` with `retryAfterMs`, and the composer shows the countdown.
- **Removal:** the sender, the host (room channel) or the captain (own team channel) may remove a message. Removal:
  - sets the body to a placeholder and records who removed it and when;
  - blanks the text in the stored `room_events` payload, so replay cannot recover it;
  - emits `chat.removed`.
- **Mutes:**
  - Set by the host on the room channel or a captain on their own team channel.
  - Last 1 s to 24 h (CHECK `expires_at <= created_at + 24 h`) and carry a reason.
  - A muted member's sends get `MUTED` with the expiry time.
  - Nobody can mute themselves.

### 4. Profiles and privacy
- **Visibility:** `members`, `friends` or `private`.
  - A profile the viewer may not see, or one where either side has blocked the other, reads as 404, the same as a missing username. Its existence is not revealed.
  - E-mail is never returned and never searched.
- **Editable fields:** `PATCH /v1/profiles/me/settings` accepts only the display name, bio, visibility and activity visibility.
  - Medal counters come only from achievement receipts written by finalization (phase 14); no request field can set them.
- **Activity:** "in a room now" is shown only to the owner and to friends, and only when the owner allows it.
- **Avatars:** `POST /v1/profiles/me/avatar`.
  - Accepts PNG, JPEG or WebP bytes up to 2 MiB. SVG and URLs are refused.
  - Each image is decoded and re-encoded to WebP at 320/640/960 px with metadata stripped, using the portrait pipeline from ADR-017.
  - It is stored as a `media_assets` row with purpose `avatar` and rights `user-upload`, owned by the user.
  - It is served through the same private media proxy as player portraits, and only while it is some profile's current avatar.
- **Member search:**
  - Username prefix of at least 3 characters (`[a-z0-9_]`), at most 20 results, rate-limited to 10 per minute per user.
  - Excludes private profiles and anyone blocked in either direction.

### 5. Friends, blocks, invitations and the inbox
- **Requests:**
  - Requests are serialised per pair with an advisory lock.
  - A duplicate request is idempotent, and a reverse request accepts the existing one.
  - At most 20 requests may be pending.
  - Only the recipient may accept (`NOT_RECIPIENT`).
  - `DELETE /friends/:id` covers decline, cancel and remove, and also cancels open room invites between the pair.
- **Blocks:**
  - A block removes any friendship and invites between the pair.
  - A blocked pair cannot request, invite, find or view each other.
  - Unblocking never restores a friendship.
- **Room invitations:**
  - Only an accepted friend can be invited, only to a room in LOBBY, and only by a member of that room.
  - Invitations expire after 2 hours.
  - The invitation carries neither the room code nor the password.
  - Accepting it (`POST /v1/rooms/invites/:id/accept`, with an Idempotency-Key) joins through the ordinary join path by room id, so capacity, lifecycle and the room password are all still checked.
- **Inbox:**
  - Covers friend requested and accepted, and room invited.
  - Each item carries a safe payload of names and ids only, never codes, passwords or chat.
  - Items expire within 30 days, and `GET /v1/notifications` returns only the caller's own items.

### 6. Web
- **Chat drawer:**
  - `features/chat/ChatDrawer` has Public and 🔒 Team tabs with separate drafts, so a message is never cross-posted.
  - It is opened from the lobby and auction setup screens, the auction stage and the card arena.
  - `/rooms/:id/chat/{public,team}` render it full page.
- **Chat panel:**
  - The message list is a `role="log"` region that follows new messages only when the reader is already at the bottom.
  - A message shows "Sending…" until acknowledged; a retry reuses its client id.
  - The composer shows a `used/500` counter and the rate-limit or mute countdown.
  - Remove and mute actions appear where the server allows them.
  - `RoomConnection.listen` delivers chat events without refetching the game snapshot.
- **Social pages:**
  - `/players/:username` is S29 (profile, read-only medals, owner editor, friend actions).
  - `/friends` is S30 (friends, requests, find, blocked, and inviting to a lobby via `?room=`).
  - `/notifications` is S31 (invitations with a password field, friend updates, mark read).
  - The shell gains Friends, an Inbox link with an unread count, and a profile link.

## Consequences
- Chat is as private as the team stream, because it is that stream. Any future change to stream access applies to chat automatically.
- The captain foreign key on `auction_franchises` is now `DEFERRABLE INITIALLY DEFERRED`. Deleting a room cascades members and franchises in one statement; a direct captain delete still fails at commit.
- **Not built in this phase:**
  - Chat reporting to administrators (S33, phase 16).
  - Notification filters on S31 (only three item types exist).
  - The achievement gallery on S29, which waits for receipts from phase 14. The achievements route already returns receipts with privacy applied.
