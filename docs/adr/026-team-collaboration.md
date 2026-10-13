# ADR-026: Team collaboration — rights, captaincy, invitations and the shortlist

- **Status:** Accepted (phase 11, 13 October 2026). It builds on ADR-024 (franchise claims and team codes) and ADR-025 (live auction). It implements rules §9 and §11 (collaborators and medal eligibility), DB/realtime §5.2 (`team_handovers`, `team_shortlists`, `shortlist_votes`), and screens S17 and S23.
- **Context:** before this phase, teammates could join only as advisors, only the captain could act, and the captaincy could not move. The spec requires:
  - two humans can run one franchise without adding a competitive or medal position;
  - explicit capability delegation, never a blanket grant;
  - captain handover by consent;
  - team codes that never bypass approval;
  - a private shortlist;
  - the host has no team privilege;
  - old tabs are fenced.

## Decision

### 1. Rights are rows, read under the room lock
- **Where rights live:** each teammate's rights are the six flags on `franchise_members`: bid, RTM, shortlist (`strategy`), set ceilings (`manageLimits`), propose retentions and invite.
- **How they are checked:**
  - Every command reads them from the database inside the room transaction. A role string or a client claim never grants anything.
  - A bid that was queued before a revocation is refused when it is handled.
  - The room host has no team powers unless they are on the team.
- **Captain:** holds every flag (CHECK from migration 060). There is never a second captain: the one-captain index and the deferred captain-pointer check stay in place.
- **Co-captain:** at most one per team (new partial unique index). They represent the team in votes (phase 14) and are first in failover (phase 12).
- **`team.permissions`:** captain only. It sets the role (co-captain, bidder or advisor) and the six flags, bumps the member's `capability_version`, and bumps the franchise `control_epoch` that phase 12's automated controller is fenced by. It cannot target the captain.

### 2. Captain handover by consent
- **`team.captain.propose`:**
  - The captain names an approved, present teammate who is not a late joiner.
  - It creates `team_handovers` (one pending per team; a new offer replaces an older one) that expires after 60 seconds on the DB clock.
- **`team.captain.accept`:**
  - Only the named teammate can accept, before the offer expires, and only while the proposer is still captain.
  - The swap happens in one transaction, in an order that keeps both unique indexes valid row by row: any co-captain becomes a bidder, the old captain becomes co-captain, the target becomes captain with every flag, then the franchise pointer moves.
  - It bumps the franchise control epoch.

### 3. Invitations
- **A code makes a pending request, never membership.**
- **`team.invite.rotate`** (captain only):
  - issues a new code, so the old one stops working;
  - revokes requests still pending;
  - optionally sets an auto-join list. The list may contain only the captain's accepted friends, which is checked at rotation and again when the friend uses the code. A friend on the list joins at once as an advisor.
- **Join commands:** `team.requestJoin` and `team.decideJoin` moved from the auctions module to the teams module. They work in the lobby and while the auction runs.

### 4. Late joiners and medals (rules §11, E61)
- **Freezing the roster:** at the start, `franchise_members.eligible_at_start` is set for every member who is ready and present.
- **Approved after the start:** the member is an advisor (shortlist and votes only), can never be promoted or made captain (`LATE_JOINER`), and cannot win this game's medal.
- **Ranking:** the franchise is ranked once, whatever its size.

### 5. The private shortlist
- **Tables:** `team_shortlists` (priority 0–100, note ≤ 500 characters, optional ceiling) and `shortlist_votes` (+1 / −1 per member).
- **Who can do what:**
  - Adding and removing targets needs the shortlist right.
  - A ceiling needs the set-ceilings right.
  - Any teammate may vote, late joiners included.
- **Effect:** the shortlist never authorizes or debits anything; only a live bid buys.
- **Privacy:**
  - `GET /v1/rooms/:id/franchises/:f/shortlist` is answered for the team's own members only. Any other team reads as 404.
  - Team events stay on the team stream.
  - The live lot carries `myTarget` for the viewer's own team only.

### 6. Tab fencing
- The dispatcher already refused commands carrying an outdated member control epoch.
- Live auction and team handlers now also re-check it after taking the room lock (`requireCurrentControl`), so a takeover that lands between the dispatcher's check and the handler still fences the old tab.

### 7. Read models
- **`GET /v1/rooms/:id/team` (`TeamViewDTO`):**
  - members with their roles, rights, start eligibility and presence;
  - join requests (captain only);
  - the code (captain and inviters);
  - the auto-join friend list (captain);
  - any open captaincy offer.
- **`ShortlistViewDTO`:** the team's targets with tallies and the viewer's own vote, plus the pool with each player's auction status.

## Consequences
- Two people can run one franchise: one of them bids while the captain sets ceilings, and the franchise is still one competitive position.
- Captaincy changes are atomic and consented. In the concurrency test, an accept racing a replacement offer always left exactly one captain matching the pointer.
- **Phase 12** uses the franchise control epoch, `control_mode` and the co-captain for automated control and failover.
- **Phase 13** adds the friend UI that feeds the auto-join list.
- **Phase 14** uses the co-captain as vote representative and `eligible_at_start` for medals.
