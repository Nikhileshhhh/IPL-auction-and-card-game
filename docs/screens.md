# Screen map, navigation and component contracts (S01–S35)

Phase 00 design contract derived from UI/UX spec §5–§6. The **Phase** column is when the screen first becomes functional; phase 16 completes polish for all screens. Every protected route group validates the session server-side in its layout **and** every API/command re-authorizes (route guards are not authorization).

## Route groups

- `(public)`: `/access`, `/auth`, legal pages, `/status`.
- `(member)`: requires bound gate grant + Auth session: `/onboarding`, `/play/**`, `/players/:username`, `/friends`, `/notifications`.
- `(room)`: member routes plus room membership: `/rooms/:id/**`.
- `(admin)`: `/admin/login` (public, gate-exempt) and `/admin/**` (admin assignment + AAL2).

## Navigation flow

```text
/access → /auth → (/onboarding) → /play
/play → Card Battle: /play/cards/create | /play/cards/join → /rooms/:id/lobby → /preparing → /cards → /results → /play
/play → Mega Auction: /play/auction/create | /play/auction/join → /rooms/:id/franchises → (/retentions) → /auction-lobby → /auction → /results → /play
Room drawers: /squad, /shortlist, /team/requests, /chat/public, /chat/team, /auto; vote modal overlays any running room view
```

## Screen table

| ID | Screen | Route | Group | Component hierarchy | Server data | Exit | Phase |
|---|---|---|---|---|---|---|---|
| S01 | Website access code | `/access` | (public) | `AccessPage > BrandPanel + AccessGate > CodeInput/AttemptsStatus/LockoutStatus` | AttemptStatusDTO | → /auth or saved safe path | 3 |
| S02 | User authentication | `/auth` | (public) | `AuthPage > GateStatus + AuthForm + RecoveryLink` | session projection | → /onboarding (incomplete) or /play | 3 |
| S03 | Player onboarding | `/onboarding` | (member) | `OnboardingForm > UsernameField/AvatarPicker/PrivacyChoice/ProfilePreview` | ProfileDTO | → /play | 3 |
| S04 | Game selection dashboard | `/play` | (member) | `AppShell > Announcement + GameSelectionCard[2] + FriendsStrip + MedalSummary` | ProfileDTO, announcements | → /play/cards/*, /play/auction/*, /players/:u, /friends | 4 |
| S05 | Card room creation | `/play/cards/create` | (member) | `RoomCreationForm > Capacity/DeckConfig/RarityPicker/Timing/Password + RulesSummary` | settings schema, catalog capacity | → /rooms/:id/lobby | 5 |
| S06 | Card room joining | `/play/cards/join` | (member) | `RoomJoinForm > GeneratedCodeInput/PasswordInput/JoinStatus` | RoomLobbyDTO | → /rooms/:id/lobby | 5 |
| S07 | Card lobby | `/rooms/:id/lobby` | (room) | `MultiplayerLobby > RoomHeader/InviteControl/PlayerRoster/RulesSummary/LobbyActions` | RoomLobbyDTO | → /rooms/:id/preparing | 5 |
| S08 | Card preparation | `/rooms/:id/preparing` | (room) | `PreparationView > FairnessSummary/DealingProgress/SeatOrder` | PermittedCardSnapshot (commitment, seats) | → /rooms/:id/cards | 7 (built) |
| S09 | Card arena | `/rooms/:id/cards` | (room) | `CardArena > TurnIndicator/VisibleCards/CardTiePot/DeckCounts/CategoryControls/ChatToggle` | PermittedCardSnapshot | → results | 7 (built; chat in 13) |
| S10 | Card comparison/detail | dialog in `/rooms/:id/cards` (ADR-021) | (room) | `ComparisonSheet > StatTable/RatingExplanation/SourceLabel` | PermittedCardSnapshot, PublicCardDTO | close → S09 | 6–7 (built) |
| S11 | Tie-break arena | `/rooms/:id/cards` (in-arena while `isTie`) | (room) | `features/cards/tie-arena: TieBanner, PotHistory, FallbackExplanation, FinishPendingNotice` | PermittedCardSnapshot (chainSelector, tieCount/tieCap, waitingSeats, contributions, finishPending, lastComparison.fallback) | → S09/S12 | 8 (built) |
| S12 | Card round victory reveal | `/rooms/:id/cards#round-result` | (room) | `RoundWinnerReveal > WinnerLabel/ComparisonResult/CardCountDelta` | lastComparison (keyed by comparison ID) | nonmodal | 7 (built) |
| S13 | Card final results | `/rooms/:id/results` | (room) | `ResultsPage > OwnCredit/Podium/RankingTable/QualificationStatus/AuditDrawer/TTL footer` (built, phase 14); arena `MatchResult` links here; after the TTL the room is purged and the page shows "Detailed match results expired" with a profile link (phase 15); `Podium` ceremony ≤1.8 s, skippable, instant with reduced motion, once per session, sound toggle (phase 16) | ResultDTO | → /play, /players/:u | 14 |
| S14 | Auction room creation | `/play/auction/create` | (member) | `AuctionCreationForm` (real-rules summary with sources, format, teams, pacing) | IPL_RULES_SUMMARY; server binds the published ruleset | → /rooms/:id/franchises | 9 (built) |
| S15 | Auction room joining | `/play/auction/join` | (member) | `AuctionJoin > RoomJoinForm/NextStepHint` | RoomLobbyDTO | → /rooms/:id/franchises | 5 |
| S16 | Franchise selection | `/rooms/:id/franchises` | (room) | `features/auction/setup: FranchiseSelection, Crest, TeamPanel` | AuctionSetupSnapshot (teams, myTeam, myRequest) | → retentions or auction-lobby | 9 (built) |
| S17 | Collaboration approval | `/rooms/:id/team/requests` | (room) | `TeamApproval > PendingRequests/CapabilityEditor/Teammates/CaptaincyOffer/InvitePanel` (built, phase 11); lobby `TeamPanel` keeps quick approval | TeamViewDTO | page | 9 (basic) / 11 |
| S18 | Retention management | `/rooms/:id/retentions` | (room) | `RetentionManager` (ordered slabs, negotiated salary, server-priced charge, RTM cards, lock dialog) | myTeam.eligible, myTeam.package | → auction-lobby | 9 (built) |
| S19 | Auction waiting lobby | `/rooms/:id/auction-lobby` | (room) | `AuctionLobbyPanel` (teams and public purses, start checklist); auto consent phase 12 | teams, members | → /rooms/:id/auction (phase 10) | 9 (built) |
| S20 | Live auction stage | `/rooms/:id/auction` | (room) | `AuctionStage > TeamsRail/LotSpotlight/LotClock/RtmPanel/LotHistory/HostControls/BidControlPanel` (built, phase 10) | AuctionLiveSnapshot (NominationDTO) | → results | 10 |
| S21 | Auction player detail | `/rooms/:id/auction?player=:id` | (room) | `PlayerDetail` dialog from the spotlight and lot history: identity, pool status/owner, ratings, career totals, source (built, phase 16; no compare picker) | AuctionPlayerDetailDTO | close → S20 | 16 |
| S22 | Franchise squad management | `/rooms/:id/squad` | (room) | `SquadView` (purse, reserve, counts, deficits, players by role); provisional XI phase 14 | SquadDTO | page (?team=) | 9 (built) |
| S23 | Player shortlist | `/rooms/:id/shortlist` | (room) | `TeamShortlist > PlayerSearch/TargetList(TargetRow: votes, ↑↓, note, ceiling)` (built, phase 11); S20 spotlight shows the own-team target | ShortlistViewDTO (own team) | page | 11 |
| S24 | Public auction chat | `/rooms/:id/chat/public` | (room) | `ChatDrawer > ChatPanel (Public tab): AudienceLabel/log MessageList/Composer (used/500, cooldown)/Remove + Mute` (built, phase 13); drawer from lobby, stage and arena | ChatChannelDTO (room) | drawer | 13 |
| S25 | Private franchise chat | `/rooms/:id/chat/team` | (room) | `ChatPanel (🔒 Team tab): PrivateAudienceBanner/ApprovedMemberList/MessageList/Composer` (built, phase 13; separate draft) | ChatChannelDTO (team) | drawer | 13 |
| S26 | Auto mode status | `/rooms/:id/auto` | (room) | `AutoModePanel > Control/Limits(editor)/BoughtAutomatically/Decisions` (built, phase 12); stage `ControlBanner` + teams-rail control labels | AutoViewDTO (StrategyDTO, control epoch) | page | 12 |
| S27 | Auction results and analysis | `/rooms/:id/results` | (room) | `ResultsPage > Podium/Ranking (member credits)/ScoreReports (numeric component table + bars, best XI with portraits, deficits)`; evaluation progress (built, phase 14); expired state after purge (phase 15); `Podium` ceremony (phase 16) | ResultDTO | → /play | 14 |
| S28 | End-game voting | `modal over current room` | (room) | `EndGameVote > host start + confirm, Dialog (threshold, server countdown, End/Keep playing, recorded choice), reopen banner, result toast` (built, phase 14) | VoteDTO | modal | 14 |
| S29 | User profile | `/players/:username` | (member) | `ProfileView > Identity/MedalStats/FriendActions/ProfileEditor (privacy, avatar)` (built, phase 13); achievement gallery phase 14; `PreferencesPanel` (motion, sound effects, low data) on the own profile (phase 16) | ProfileDTO | — | 13 |
| S30 | Friends interface | `/friends` | (member) | `FriendsPage > Friends/Requests/Find/Blocked tabs; Invite buttons with ?room=` (built, phase 13) | FriendsViewDTO | — | 13 |
| S31 | Notifications center | `/notifications` | (member) | `NotificationsPage > Invitations (password, Join)/Updates (mark read)`; shell `InboxLink` unread count (built, phase 13) | NotificationsViewDTO | → lobby | 13 |
| S32 | Administrator login | `/admin/login` | (admin) | `AdminLogin > Credentials/MFAChallenge/SessionNotice` | admin challenge | → /admin | 3 |
| S33 | Administrator dashboard | `/admin` | (admin) | `AdminShell > OperationsOverview (HealthOverview, rooms by state, ActiveRoomTable, AuditPreview)` at `/admin`; Access `/admin/access`; Users (restrictions with step-up) `/admin/users`; Announcements `/admin/announcements`; `CleanupQueue` `/admin/cleanup` (phase 15); design-review gallery `/admin/design-review` (built, phase 16) | AdminOverviewDTO, AdminRoomsDTO, AdminUserDTO, CleanupQueueDTO | → /admin/* | 16 |
| S34 | Game/data configuration management | `/admin/catalog` | (admin) | `CatalogAdmin > VersionList/SchemaForm/SourceEditor/RightsPanel/ValidationDiff/PublishAction` | drafts, sources, media | — | 6 |
| S35 | Error, maintenance and disconnection | `global overlays and /status` | (public) | `ConnectionBoundary > StatusBanner/RetryPanel/LastConfirmedState/RecoveryCountdown`; `RecoveryBanner` (outage countdown) and `MissedRecap` (phase 12); `/status` probes `/health/ready` (Ready/Degraded/Unreachable with time, phase 16) | connection FSM, `recoveryUntil` | — | 4 / 12 |

## Portrait requirement (ADR-017)

Screens that show a player identity must render its portrait: S08 (dealing preview uses card backs only — undealt identities stay hidden), S09–S12 (every revealed card), S13 (winning card summary), S16/S18 (retention roster rows), S20 (spotlight, large), S21 (detail drawer), S22 (squad rows), S23 (shortlist rows), S27 (recommended XI). Missing/failed images fall back to the original silhouette with a text label.

## Shared state ownership

Zustand room store (one per current room) owns the permitted snapshot + per-stream cursors; TanStack Query owns HTTP resources (profile, catalog, friends). Local React state owns drawers, drafts, animation progress. Derived purse/score values are read from the canonical projection, never adjusted locally. Animations key off `eventId`; reconnect renders current state without replaying celebrations.
