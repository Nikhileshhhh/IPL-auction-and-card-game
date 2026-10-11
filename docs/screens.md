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
| S11 | Tie-break arena | `/rooms/:id/cards?phase=tie` | (room) | `TieArena > EligibilityBanner/CardTiePot/EligibleCards/SelectorControls` | PermittedCardSnapshot (tie fields) | → S09/S12 | 8 |
| S12 | Card round victory reveal | `/rooms/:id/cards#round-result` | (room) | `RoundWinnerReveal > WinnerLabel/ComparisonResult/CardCountDelta` | lastComparison (keyed by comparison ID) | nonmodal | 7 (built) |
| S13 | Card final results | `/rooms/:id/results` | (room) | `VictoryPodium > ResultSummary/RankingTable/QualificationStatus/AuditDrawer` | ResultDTO | → /play, /players/:u | 14 |
| S14 | Auction room creation | `/play/auction/create` | (member) | `AuctionCreationForm > RulesetPicker/FormatSelector/PoolPicker/TimerFields/RuleSummary` | rulesets, data versions | → /rooms/:id/franchises | 9 |
| S15 | Auction room joining | `/play/auction/join` | (member) | `AuctionJoin > RoomJoinForm/NextStepHint` | RoomLobbyDTO | → /rooms/:id/franchises | 5 |
| S16 | Franchise selection | `/rooms/:id/franchises` | (room) | `FranchiseSelection > FranchiseCard[]/MembershipSummary` | franchises, teams | → retentions or auction-lobby | 9 |
| S17 | Collaboration approval | `/rooms/:id/team/requests` | (room) | `TeamApproval > PendingRequests/CapabilityEditor/InviteCodePanel` | join requests | drawer | 11 |
| S18 | Retention management | `/rooms/:id/retentions` | (room) | `RetentionManager > EligibleRoster/RetentionSlots/CostBreakdown/ConfirmPanel` | previous roster, cost model | → auction-lobby | 9 |
| S19 | Auction waiting lobby | `/rooms/:id/auction-lobby` | (room) | `AuctionLobby > FranchiseRoster/RetentionStatus/AutoConsent/StartChecklist` | teams, members | → /rooms/:id/auction | 9 |
| S20 | Live auction stage | `/rooms/:id/auction` | (room) | `AuctionStage > FranchiseRosterPanel/AuctionPlayerSpotlight/AuctionCountdown/AuctionHistory/BidControlPanel` | NominationDTO | → results | 10 |
| S21 | Auction player detail | `/rooms/:id/auction?player=:id` | (room) | `PlayerDetail > Identity/Statistics/PhaseSkills/SourceInfo/ComparePicker` | PlayerPublicDTO | close → S20 | 10 |
| S22 | Franchise squad management | `/rooms/:id/squad` | (room) | `SquadManager > PurseTracker/RoleCoverage/SquadTable/ProvisionalXI` | SquadDTO | drawer/page | 9 |
| S23 | Player shortlist | `/rooms/:id/shortlist` | (room) | `TeamShortlist > PlayerSearch/TargetList/RecommendationVotes` | StrategyDTO (own team) | drawer/page | 11 |
| S24 | Public auction chat | `/rooms/:id/chat/public` | (room) | `PublicChat > AudienceLabel/MessageList/Composer/ModerationMenu` | chat channel | drawer | 13 |
| S25 | Private franchise chat | `/rooms/:id/chat/team` | (room) | `TeamChat > PrivateAudienceBanner/ApprovedMemberList/MessageList/Composer` | team channel | drawer | 13 |
| S26 | Auto mode status | `/rooms/:id/auto` | (room) | `AutoModePanel > ControlStatus/SpendLimits/MissedPurchases/TakeoverAction` | StrategyDTO, control epoch | panel | 12 |
| S27 | Auction results and analysis | `/rooms/:id/results` | (room) | `AuctionResults > VictoryPodium/FranchiseLeaderboard/ScoreBreakdown/RecommendedXI/MemberCredits` | ResultDTO | → /play | 14 |
| S28 | End-game voting | `modal over current room` | (room) | `VoteCountdownModal > ElectorateSummary/Countdown/EndButton/ContinueButton/RecordedChoice` | VoteDTO | modal | 14 |
| S29 | User profile | `/players/:username` | (member) | `ProfileOverview > Identity/MedalStats/AchievementGallery/FriendActions` | ProfileDTO | — | 13 |
| S30 | Friends interface | `/friends` | (member) | `FriendsPage > Search/FriendList/RequestPanel/InvitePicker` | relationships | — | 13 |
| S31 | Notifications center | `/notifications` | (member) | `NotificationCenter > Filter/NotificationList/ActionLink` | notifications | → join flow | 13 |
| S32 | Administrator login | `/admin/login` | (admin) | `AdminLogin > Credentials/MFAChallenge/SessionNotice` | admin challenge | → /admin | 3 |
| S33 | Administrator dashboard | `/admin` | (admin) | `AdminShell > HealthOverview/ActiveRoomTable/CleanupQueue/AuditPreview` | admin overview | → /admin/* | 16 |
| S34 | Game/data configuration management | `/admin/catalog` | (admin) | `CatalogAdmin > VersionList/SchemaForm/SourceEditor/RightsPanel/ValidationDiff/PublishAction` | drafts, sources, media | — | 6 |
| S35 | Error, maintenance and disconnection | `global overlays and /status` | (public) | `ConnectionBoundary > StatusBanner/RetryPanel/LastConfirmedState/RecoveryCountdown` | connection FSM | — | 4 |

## Portrait requirement (ADR-017)

Screens that show a player identity must render its portrait: S08 (dealing preview uses card backs only — undealt identities stay hidden), S09–S12 (every revealed card), S13 (winning card summary), S16/S18 (retention roster rows), S20 (spotlight, large), S21 (detail drawer), S22 (squad rows), S23 (shortlist rows), S27 (recommended XI). Missing/failed images fall back to the original silhouette with a text label.

## Shared state ownership

Zustand room store (one per current room) owns the permitted snapshot + per-stream cursors; TanStack Query owns HTTP resources (profile, catalog, friends). Local React state owns drawers, drafts, animation progress. Derived purse/score values are read from the canonical projection, never adjusted locally. Animations key off `eventId`; reconnect renders current state without replaying celebrations.
