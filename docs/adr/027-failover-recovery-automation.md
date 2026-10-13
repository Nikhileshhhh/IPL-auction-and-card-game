# ADR-027: Failover, outage recovery and safe automated bidding

- **Status:** Accepted (phase 12, 13 October 2026). It implements rules §1 (presence timings), §9 (control policy, failover, strategy, bot timing, resume) and §11 (participation), DB/realtime §4 (restart recovery), and screens S26 and S35. It builds on ADR-007 (durable deadlines), ADR-025 (live auction) and ADR-026 (team rights).
- **Context:** before this phase:
  - a team whose people dropped out simply stopped bidding;
  - a server restart let overdue lot clocks sell players nobody could bid on;
  - the presence timings were looser than the spec: a 10 s heartbeat and a 30 s TTL.

  The spec asks for:
  - deterministic, opt-in automation that never beats the configured caps or reserve;
  - one controller at a time, fenced by an epoch;
  - an explicit, consented return to manual control;
  - a recovery pause after an outage.

## Decision

### 1. Presence (5 s heartbeat, 15 s stale, 30 s grace)
- **Heartbeat:** the browser pings every 5 s, and a connection row expires 15 s after its last heartbeat. Swept stale rows become offline presence.
- **Participation (medal eligibility):** counted as the union of a member's connected time. An interval opens when their first live tab appears in a running game and closes when the last tab goes. The close time is the earlier of now and last heartbeat + 30 s, so a sleeping phone is credited the grace once, never the whole absence. At the start, an interval opens only for members who are connected.

### 2. Franchise control: MANUAL → FAILOVER → AUTO / OBSERVE
Control belongs to each franchise and is independent of the room state. When the last authorised bidder (the captain or a member with the bid right) goes offline in a running auction, an `auction.team_absence` check is scheduled 30 s later. Under the room lock it decides:

| Situation | Result | Reason code |
|---|---|---|
| Any authorised bidder is connected | Stays MANUAL. An offline captain alone never starts a bot. | — |
| A connected co-captain exists | FAILOVER: they hold control and may bid even without the bid right | `BIDDERS_ABSENT` |
| An enabled saved strategy exists | AUTO | `ALL_BIDDERS_ABSENT` |
| Neither | OBSERVE: nothing is bid | `NO_STRATEGY` |

Every change:
- bumps the franchise `control_epoch`;
- records the reason and the time;
- emits a private `team.controlChanged`;
- shows a public control label (Automatic, Observing, Co-captain in control) on the teams rail, which reveals the team's status, never its limits.

While a team is AUTO or OBSERVE, its people's bids, RTM decisions and limit edits are refused (`TEAM_NOT_MANUAL`, `TAKE_OVER_FIRST`). There is one controller at a time.

### 3. Resume manual control (`team.auto.takeover`)
- **Who:** the captain, the co-captain, a bidder or the failover holder.
- **Fencing:** the request carries the franchise control epoch it saw; a stale epoch gets `CONTROL_EPOCH_STALE`.
- **Effect:** in one transaction the mode returns to MANUAL, the epoch is bumped, and pending automated attempts for the team are deleted. Bids and purchases already committed stay.
- **Race with the bot:** a takeover and a due bot attempt serialise on the room lock. The bot's bid counts only if it committed first.
- **No invented consent:** control never returns to manual automatically.

### 4. Automated bidding (`packages/game-engines/src/auction/auto.ts`, pure)
- **Strategy:** private, versioned and edited with `team.auto.configure` by the captain or a limits manager. It holds:
  - named targets with ceilings (the S26 page uses the shortlist players that have a ceiling, in shortlist order);
  - per-role ceilings, used only while the squad still needs that role (simulator choice: batters 6, bowlers 6, all-rounders 4, keepers 2);
  - a total automated cap and a maximum number of automated purchases;
  - the team's own reserve;
  - optional right to match, with an RTM ceiling.
- **Bid rule:** at each lot version the bot bids the server's next legal amount only if:
  - next ≤ min(player or role ceiling, cap − spent, purse − minimum-squad reserve, purse − own reserve);
  - purchases are below their maximum;
  - the team is not already leading;
  - the shared validator accepts (squad, overseas, purse reserve, legal XI).
- **Defaults:** a missing or disabled strategy never bids. The bot never raises its own final RTM offer; it holds.
- **Explanation:** each decision is a private `team.autoDecision` with a reason code. S26 shows them in plain words such as "Skipped: above the ceiling (₹3 cr)" and never claims to be AI.
- **One path for every bid:** human and automated bids are written by the same `placeBid` (`auctions/bidding.ts`) after the same validator, with `actorType` `human` or `auto`.
- **Timing:**
  - attempts are deadline jobs keyed by (team, bid version), so there is at most one per version and none are hot-looped;
  - the delay is a deterministic 700–1,300 ms from the lot number and seat, rotating every lot;
  - the bot sees nothing of other teams' strategies.
- **Counters:** spend and purchase counters move only at a sale whose last winning offer was automated.

### 5. Outage recovery pause
- **Detecting an outage:** the coordinator lease now reports when an instance takes it over from a different owner whose last heartbeat is more than 5 s old. This means a crash or restart; a graceful shutdown deletes the lease row instead.
- **What is paused:** every running room with an overdue gameplay clock (lot, RTM, gap, pause, bot and card selection timers).
- **How:** each clock keeps the time it had left at the last healthy heartbeat (never below zero), plus a visible 10 s countdown (`rooms.recovery_until`, `recovery_generation`).
- **During the countdown:**
  - gameplay commands get `GAME_PAUSED`;
  - the snapshot carries `recoveryUntil`;
  - sockets receive `server.recovering` and refresh.
- **Not affected:** hard limits and room housekeeping keep their time. Votes (phase 14) keep their original deadline.

### 6. Reconnect
Phase 05 already gives a fresh one-use ticket per connection, a snapshot with cursors on subscribe, and replay or snapshot on a gap; the browser state is only ever the last confirmed server state. This phase adds:
- **Recap:** after a reconnect the auction stage shows the real results that happened while the tab was away, with the team's own purchases first and its purse now.
- **Privacy:** a member who leaves a team can no longer replay its private stream, because the stream ACL is checked on every replay.

## Consequences
- In the integration test the bot stopped at its ceiling and at the total cap, and counted its purchase once. A missing strategy observes. Taking over cancels pending attempts and is fenced by the epoch.
- A server crash cannot sell lots while nobody could bid.
- **Phase 14** reads `participation_ms` and the frozen roster for medals; votes use their original deadlines through a recovery pause.
- **Not built:** a planned-deployment drain notice and alerting on repeated heartbeat gaps are left for phase 19 (operations).
