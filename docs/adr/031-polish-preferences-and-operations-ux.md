# ADR-031: Polish, UI preferences, sound and the operations surfaces

- **Status:** Accepted (phase 16, 17 October 2026).
- **Implements:**
  - UI spec §3 (motion, reduced motion, audio, skip animation), §4 (responsive and accessibility contract), §6 (component ownership), §7 (asset budgets) and §8 (design acceptance).
  - Screens S13/S27 (podium), S21 (auction player detail), S29 (display and sound settings), S33 (administrator dashboard) and S35 (service status).
  - DB/realtime §8.1, the phase-16 operations: `GET /v1/admin/overview`, `GET /v1/admin/rooms`, `POST /v1/admin/users/:id/restrictions` and `POST /v1/admin/announcements`.
- **Context:** Phases 01–15 built every game flow, but four things were missing.
  - **Motion and sound:**
    - Motion followed only the device setting. No member could override it, and there was no skip-animation control.
    - There was no sound at all, and no rule for when a sound may play.
    - The podium appeared without a ceremony.
  - **Screens:**
    - The administrator dashboard was a placeholder; operators had no view of health, rooms or recent actions, and no way to restrict a member or post an announcement.
    - The status page said only that it made no claims.
    - The auction had no player detail.
  - **Low data:** there was no low-data mode.
  - **Visual review:** nothing checked every screen at every target size.

## Decision

### 1. Preferences are noncritical and server-owned
- **Storage:** migration `130_ui_preferences` adds one row per member: `motion` (`system`, `reduce` or `full`), `sound_effects` (default off) and `low_data` (default off).
  - The table has FORCE RLS and cascades with the profile.
  - A missing row means the defaults.
- **API:** `GET` and `PATCH /v1/me/preferences`.
  - A patch must change at least one field.
  - Unknown fields and values are refused.
- **Scope:** preferences change only presentation. The server never reads them while deciding anything.

### 2. Applying preferences
- **On the document:** the browser copies the preferences onto `<html>` as `data-motion` and `data-low-data`.
  - The copy is made first from a localStorage cache and then from the server.
  - If saving fails, the previous choice is restored.
- **Motion rules in CSS:**
  - Reduced-motion rules apply when the member chose `reduce`, or when the device asks for less and the member did not choose `full`.
  - Before any script runs, the device setting still applies through the media query.
- **What reduced motion and low data do:**
  - Shine, holographic sweeps, sparkles, deal and banner animations and the podium rise all stop.
  - Rarity colours and a static glow stay.
- **Low data also:**
  - requests the 320 px portrait variant instead of 640 or 960;
  - keeps the frames static.

### 3. Sound: original, opt-in and once per event
- **Original tones:** cues are synthesized with the Web Audio API. There are no recordings, no jingles and nothing to license.
- **The cues:**
  - reveal
  - round won
  - bid accepted
  - sold
  - unsold
  - medal
  - vote opened
- **Limits:** each cue is under 1.2 s, and every note is at gain 0.15 or below.
- **When sound plays:** only after the member turns it on and the browser has seen a gesture. The checkbox click counts as one, and plays a preview.
- **Once per event:**
  - Every cue is keyed by a server identity: comparison ID, nomination and bid version, nomination and outcome, vote ID, or room ID for the medal.
  - A key is remembered before the mute check, so an event that passed while muted never plays later.
  - The memory is bounded to 500 keys.
  - `useCue` treats the key already on screen at mount as heard, so a refresh or reconnect never replays a sound.
- **Never the only signal:** every cue duplicates text that is already on screen.
- **Quick toggle:** "Sound on / Sound off" in the arena, on the stage and on the podium saves the same preference.

### 4. Podium ceremony
`Podium` shows only the medals the server committed. The ceremony is a CSS rise of each step, in the order bronze, silver, gold, finishing within 1.8 s.
- **Never covers anything:** all text is in the page from the start, and nothing covers or waits for the animation.
- **Skippable:** "Skip animation" ends it at once.
- **Reduced motion:** the final layout appears immediately.
- **Once per session:** it plays the first time a browser session sees the results. The decision is cached per room, so a re-render or a reload shows the final layout.
- **Sound:** the medal tone plays only for a member credited with a medal.

### 5. S21 auction player detail
- **Endpoint:** `GET /v1/rooms/:id/players/:playerId`. It is open to members only; outsiders get 404.
- **What it returns:**
  - the pool player;
  - where the player stands in this room's pool (status and owner);
  - every rating in the room's frozen data version;
  - raw career totals;
  - the statistics source.
- **On the stage:** it opens as a dialog from the spotlight ("Player details") and from the lot history, and the `?player=` URL makes it linkable.
- **Read only:** it never bids. It says whether the player is under the hammer and sends the member back to the live controls.

### 6. S33 operations
- **Overview** (AAL2):
  - database and migration state, and worker leases with heartbeats;
  - rooms by lifecycle, live connections and the cleanup queue totals;
  - security warnings in the last 24 hours and the number of suspended members;
  - recent announcements;
  - the last 20 audit actions (action, target class, actor username and time, never `safe_diff`).
- **Room table** (AAL2): ID prefix, game, lifecycle, member and connection counts, timestamps and the cleanup reason. It has no names, codes, members, chat, cards or results.
- **Measured, never guessed:** every number is measured when the request is made. The page shows when it was measured and labels stale data after 60 s. A failing widget reports its own failure and never shows a fake count.
- **Member restrictions:**
  - **Lookup:** by exact username only (`GET /v1/admin/users`), never by email or prefix.
  - **Suspend or lift:** needs AAL2 and a step-up within 5 minutes.
  - **Effect of a suspension:** every session is revoked, and sockets on this instance close at once (`user.suspended`). A suspension lasts at most one year.
  - **Who cannot be restricted:** nobody can restrict themselves, and administrators cannot be restricted here.
  - **Audit:** an audit row records the action and the reason's length, never its text.
- **Announcements:**
  - created with a title, a body and a time window;
  - archived early by `POST /v1/admin/announcements/:id/archive`;
  - stored verbatim and shown as text.
- **Navigation:** the admin shell gains Operations, Access (moved from `/admin` to `/admin/access`), Users, Announcements and a design-review gallery.

### 7. S35 status
`/status` runs one probe of `/health/ready` from the web server with a 3 s timeout. It shows one of three states, Ready, Degraded or Unreachable, with the time it ran and each check as OK or Problem.
- **Never claimed:** uptime, live counts and internal detail.
- **Reassurance:** it tells members that running games pause and resume.

### 8. Visual review as a test suite
- **Suite:** `tests/visual/screens.spec.ts`, run by `pnpm test:visual` as a separate Playwright project.
- **Sizes:** every reachable member and admin screen at 360×800, 390×844, 768×1024, 1024×768 and 1440×900, plus 320 px reflow and 200% zoom (720×450 CSS px).
- **Checks at every size:**
  - no horizontal page scroll;
  - an `h1`;
  - control text of at least 14 px;
  - targets of at least 44 px tall (inline text links exempt);
  - axe with no serious or critical violations at the smallest and largest sizes.
- **Screenshots:** attached to the run for human review, not used as pixel baselines.
- **Further tests:**
  - motion overrides;
  - low-data portraits;
  - image-error fallback;
  - private portrait caching and denial without a session;
  - a stable primary action on a slow network;
  - the dashboard transfer budget (1.5 MB).
- **Design-review gallery:** `/admin/design-review` renders the spec §8 edge cases from fixed fixtures with original artwork only:
  - six rarities and the dual frame;
  - long names;
  - 0, 100 and 101 ratings;
  - a broken image;
  - large rupee amounts;
  - zero cards and a full pot;
  - a 25-player squad.
- **Contrast:** `pnpm design:contrast` measures every token pair the UI uses against its WCAG target.

## Consequences
- **Members:** they can tame motion, hear quiet original cues or save data on every device. None of it can affect a match.
- **Operators:** they can see health, rooms and actions and act on members without seeing private play.
- **Regressions:** layout and accessibility regressions at any target size now fail a test instead of waiting for a manual pass.
- **Not done:**
  - **Screen readers:** no manual screen-reader pass (VoiceOver, TalkBack, NVDA). Axe does not certify compliance, and `docs/design-review.md` lists this as open.
  - **Socket fan-out:** suspension disconnects sockets on the same instance only. Sockets on other instances are refused at their next ticket or room join (the same limit as ADR-030).
  - **Animation library:** the `motion` library is still unused. CSS covers every current animation, and card travel to the pot is a count change, not a flight.
