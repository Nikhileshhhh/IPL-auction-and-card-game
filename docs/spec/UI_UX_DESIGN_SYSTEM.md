# UI/UX Design System and Screen Specifications

**STUMPS v1.0 • 9 October 2026 • Proposed original visual identity.** This specification is implementation-ready interaction design, not a claim that finished artwork or a rendered prototype exists. All artwork must follow the rights workflow in the master plan. Real IPL/team branding is an optional licensed asset pack; the default demo uses original city teams, original crests and fictional player portraits labeled DEMO.

## 1. Product feel and information hierarchy

Create a private cricket club with two arenas: collectible cards and an auction stage. The product should feel calm before the game, precise during decisions and celebratory after an earned result. During play the first visible information is whose action is needed, how much time remains, the relevant card/player and the legal action. Connection state is always legible. Do not cover bids with confetti or move a button under a user's finger when a price changes.

Working wordmark: STUMPS, simple editorial lettering with a small three-stump motif. Card Battle accent is emerald with silver collectible framing. Mega Auction accent is muted amber with deep blue stage surfaces. No imitation of existing card frames, broadcasts, franchise emblems or recognizable sponsor layouts. Do not put IPL in the product logo or imply official affiliation. The selected historical ruleset can be described factually in the room configuration.

## 2. Design tokens

| Token | Value | Use |
|---|---|---|
| bg/base | #07111F | Main midnight background |
| bg/raised | #101E30 | Panels and navigation |
| bg/overlay | #172941 | Menus/modals |
| text/primary | #F4F7FB | Main copy |
| text/secondary | #B5C3D6 | Supporting copy |
| text/muted | #91A5C0 | Disabled/explanatory text; verify contrast per surface |
| line/default | #334B66 | Borders and separators |
| accent/card | #44E0B1 | Card mode primary action with dark text |
| accent/auction | #F0C879 | Auction primary action with dark text |
| accent/focus | #7DBAFF | 2px keyboard focus ring plus 2px offset |
| status/success | #72DDA7 | Icon + label, never color alone |
| status/warning | #FFD280 | Budget or connection warning |
| status/error | #FF9EA5 | Error text on dark surfaces |
| rarity/normal | #9AAFC4 | Neutral edge |
| rarity/bronze | #CF9466 | Warm bronze |
| rarity/silver | #D6E1ED | Cool silver |
| rarity/gold | #EBC875 | Gold foil |
| rarity/platinum | #BCE5F1 | Platinum edge |
| rarity/dual | #CBB9FF | Dual platinum spectral accent |

Self-host an appropriately licensed Inter-family font for UI, an original licensed display face or system condensed fallback for arena headings, and tabular-number features for money/timers. Record font license files. Type: 12/16px metadata, 14/20 labels, 16/24 body, 20/28 section headings, 28/34 card names, 40/46 desktop page heading, 56/60 hero only. Mobile hero 32/38; never shrink interactive body text below 14. Monetary amounts use Indian grouping and explicit lakh/crore units with a full-rupee tooltip/screen-reader label. Timer numerals do not shift width.

Spacing base4: 4,8,12,16,20,24,32,40,48,64,96px. Minimum page gutters16 mobile,24 tablet,40 desktop; max content width1440. Grid12 columns with 24px gap on desktop,8/16 tablet,4/12 mobile. Radius8 controls,12 small panels,20 major panels,24 feature tiles; card art frame16, aspect ratio5:7. Borders1px; focus2px; arena separators use solid lines, not faint glow alone.

Shadow tokens: panel `0 8px 24px rgba(0,0,0,.24)`; hover `0 16px 40px rgba(0,0,0,.32)`; overlay `0 24px 80px rgba(0,0,0,.48)`. Limit elevation to three layers. Glass is restricted to decorative hero overlays with opaque fallback; no translucent statistics or bidding controls. Metallic surfaces use layered static CSS gradients, highlights confined to frame edges and optional low-opacity texture. Avoid blur filters over full-screen animations.

Iconography: use one consistent open-source icon set, preferably Lucide with its license retained. Use20px icons in compact controls,24px in navigation and32px only for empty states; stroke width2px. Pair critical actions and connection/privacy/medal status with text. A crown means room host, a shield means franchise captain, and a lock means restricted audience; do not reuse the same symbol for different permissions. Never use an unlabeled colored dot as the only warning.

## 3. Components, interaction and motion

Buttons: primary accent fill with midnight text, secondary raised fill/border, tertiary text+icon, danger error-tinted surface with explicit label. Sizes44px minimum touch target,48px normal,56px key bid/action; icon-only buttons have accessible names. Every mutation supports idle, pending, success, rejected, offline. Pending bid label is “Submitting ₹2.2 cr…” and becomes accepted only after server ack. Do not optimistically deduct money, award cards or vote twice. Disabled buttons explain the reason beside the control; tooltips are supplementary.

Card art: 320×448px standard,240×336px compact,520×728px detail; always keep a separate accessible stat table. Portrait occupies upper55%, names across lower portrait margin, six ratings in a2×3 grid below, stars and rarity in a dedicated footer. Frame has corner geometry and etched line details, while content uses a stable grid across rarities. Bronze adds copper edge; silver cool directional reflection; gold diagonal restrained foil; platinum slow spectral border; dual splits portraits diagonally with equal name weight and both associations. No rarity effect obscures numbers or supplies false power. On a 360px phone use a single main card plus opponent strip and expand-to-compare bottom sheet, not four unreadable cards.

Motion durations: instant feedback80–120ms, panel transition160–220ms, card flip360ms, result reveal700ms, podium sequence1.8s max. Ease out for entrance, symmetric ease for reversible states. CSS handles hover, focus, opacity, skeletons and decorative sheen. Motion handles layout transitions, card movement from arena to pot, keyed reveals and interruption-safe dialogs. The engine never waits for animation completion. Each animation keys off eventId; reconnect renders current state immediately instead of replaying old celebrations. Skip-animation action is available.

Reduced motion: replace flips/particle travel with crossfade≤ 100ms, no camera shake/parallax/continuous shimmer, instant podium layout. Audio disabled until user interaction and explicit preference; independent effects mute, remembered as UI preference. Use licensed original short reveal/auction ticks; audio never conveys unique information. Do not recreate copyrighted broadcast jingles. Late-bid sound at most once per distinct accepted event. Avoid screen-reader countdown announcements each second; announce10s,5s and expiry once.

Skeletons preserve actual layout and aspect ratios. Toasts show concise result/error with an optional “Retry” only when retry is safe; persistent connection problems use a banner rather than repeating toasts. Empty states identify the missing prerequisite and a single next action. Public/team chat tabs use explicit audience labels and lock icons; color alone never identifies privacy. Modal focus is trapped and restored; destructive dialogs state consequences and primary action precisely.

## 4. Responsive and accessibility contract

Breakpoints: compact<640, medium640–1023, wide≥ 1024, very wide≥ 1440. Auction desktop has 240px franchise rail, min480px stage,320px activity panel and persistent100px action rail. At1024–1279 collapse activity to a drawer. Mobile has64px app bar, player stage, compact highest bid/clock, expandable franchise strip and bottom action area above safe-area inset; chat/squad becomes a full-height sheet. Never force landscape or horizontal page scroll. Tables may horizontally scroll inside labeled regions with sticky row labels.

All screens inherit: semantic landmarks/headings, keyboard completion, visible focus, no hover-only actions, 44px targets, screen-reader status messages, zoom200%, reflow320CSSpx, no color-only meaning, contrast target WCAG2.2AA (4.5:1 normal text,3:1 large text/nontext controls). Actual token pairs and imagery overlays must be measured, not assumed compliant. Use aria-live polite for status and assertive only for control loss/critical action errors. Toasts do not steal focus. A user must be able to play both games without drag/drop or animation.

## 5. Screen-by-screen specification

Every screen below has a purpose, desktop/mobile wireframe, component hierarchy, actions/navigation, loading/error behavior, data and accessibility/interaction details. Shared defaults in sections2–4 are mandatory, not optional shorthand.

### S01 — Website access code

**Route:** `/access`

**Purpose and visual priority:** Verify an invitation before exposing platform data.

**Desktop wireframe:** Two columns: original stadium silhouette at left60%; centered400px form at right. Logo, privacy note, input, attempts, submit in that order.

**Mobile wireframe:** Single column; small crest, short headline, masked input and full-width submit above keyboard. No auto-scrolling carousel.

**Component hierarchy:** `AccessPage > BrandPanel + AccessGate > CodeInput/AttemptsStatus/LockoutStatus`.

**Primary/secondary actions and navigation:** Enter code; show/hide; request help copy; separate small Admin link. Success navigates to auth or saved safe path.

**Required server data:** AttemptStatus, gate expiry, serverNow; never the correct code.

**Loading, empty, error and connection states:** Skeleton only while status loads; wrong code keeps input focus; lockout persists after refresh and disables submit with exact unlock time.

**Interaction, accessibility and animation:** Enter submits once; paste supported; announced remaining attempts; no client counter reset or shame language. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S02 — User authentication

**Route:** `/auth`

**Purpose and visual priority:** Authenticate the already-admitted visitor.

**Desktop wireframe:** Compact card with Sign in/Create account tabs and security context; email/password and recovery link.

**Mobile wireframe:** Full-width card with visible password affordance and keyboard-aware submit.

**Component hierarchy:** `AuthPage > GateStatus + AuthForm + RecoveryLink`.

**Primary/secondary actions and navigation:** Sign in; request invitation; recover password. Success to onboarding for incomplete profile, dashboard otherwise.

**Required server data:** Auth session projection, gate validity, enrollment status.

**Loading, empty, error and connection states:** Preserve email on error; never echo password; generic invalid credentials; expired gate returns to access preserving safe destination.

**Interaction, accessibility and animation:** Proper autocomplete email/current-password/new-password; logical labels; invitation confirmation exposes no account existence. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S03 — Player onboarding

**Route:** `/onboarding`

**Purpose and visual priority:** Create a recognizable private-club identity.

**Desktop wireframe:** Profile preview at right; username, display name, avatar picker and privacy fields at left.

**Mobile wireframe:** Form first, compact preview below; avatar opens sheet.

**Component hierarchy:** `OnboardingForm > UsernameField/AvatarPicker/PrivacyChoice/ProfilePreview`.

**Primary/secondary actions and navigation:** Save and enter; optional skip bio/avatar; cannot skip valid username.

**Required server data:** Own profile, username availability, approved avatar choices.

**Loading, empty, error and connection states:** Debounced availability300ms; reserve username only on save; collision offers editable suggestion; upload progress with cancel.

**Interaction, accessibility and animation:** Privacy choices plain language; preview decorative duplicate is hidden from AT; no private email display. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S04 — Game selection dashboard

**Route:** `/play`

**Purpose and visual priority:** Choose a game and see friends/profile achievements.

**Desktop wireframe:** Header with identity; two equal feature tiles beneath a concise greeting; friends strip and recent earned medals below.

**Mobile wireframe:** Stack two compact illustrated tiles with both titles visible within first two screens; friends as optional drawer.

**Component hierarchy:** `AppShell > Announcement + GameSelectionCard[2] + FriendsStrip + MedalSummary`.

**Primary/secondary actions and navigation:** Play Card Battle or Enter Auction opens respective create/join hub; profile/friends navigation.

**Required server data:** ProfileDTO, summaries, announcements, permitted friend activity.

**Loading, empty, error and connection states:** Independent tile skeletons; no-friends invite guidance; announcement failure does not block games.

**Interaction, accessibility and animation:** Hover lifts≤ 4px; keyboard focus has same emphasis; ambient effects pause when offscreen. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S05 — Card room creation

**Route:** `/play/cards/create`

**Purpose and visual priority:** Configure a fair card match before inviting friends.

**Desktop wireframe:** Two-thirds settings sections, one-third sticky rule summary showing player count, deck total, rarities and timer.

**Mobile wireframe:** Settings in accordion with summary before Create; inline divisibility hint.

**Component hierarchy:** `RoomCreationForm > Capacity/DeckConfig/RarityPicker/Timing/Password + RulesSummary`.

**Primary/secondary actions and navigation:** Create room; back to game hub. Changing to an uneven total requires explicit corrected choice.

**Required server data:** Card catalog capacity, permitted settings schema, preview configuration hash.

**Loading, empty, error and connection states:** Validation beside field; no eligible deck message lists constraints to loosen; submitting disables duplicate creation.

**Interaction, accessibility and animation:** Fieldsets for related settings; sliders always have numeric input; proposed tie fallback visible before create. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S06 — Card room joining

**Route:** `/play/cards/join`

**Purpose and visual priority:** Join the intended game securely.

**Desktop wireframe:** Centered code field, optional password challenge and a short member identity preview.

**Mobile wireframe:** Single input group supporting pasted formatted code; password below when needed.

**Component hierarchy:** `RoomJoinForm > GeneratedCodeInput/PasswordInput/JoinStatus`.

**Primary/secondary actions and navigation:** Join; paste invitation; back. Success only to lobby, never automatically starts.

**Required server data:** Own profile, join response; no public room directory.

**Loading, empty, error and connection states:** Invalid code/password share generic response; full/game-started errors only after validated invite; retry limit shown.

**Interaction, accessibility and animation:** Normalize spaces/hyphens; no invitation code in analytics or URL query; fragment invite consumed then removed. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S07 — Card lobby

**Route:** `/rooms/:id/lobby`

**Purpose and visual priority:** Agree on settings and readiness.

**Desktop wireframe:** Main participant roster with seat cards; right rule summary and invite panel; host start at bottom.

**Mobile wireframe:** Roster list then collapsible rules; sticky Ready control, host Start secondary visible.

**Component hierarchy:** `MultiplayerLobby > RoomHeader/InviteControl/PlayerRoster/RulesSummary/LobbyActions`.

**Primary/secondary actions and navigation:** Copy code/link; ready; host change settings/kick/transfer/start; leave.

**Required server data:** RoomLobbyDTO, configVersion, presence, me capabilities.

**Loading, empty, error and connection states:** Joining rows animate in; disconnected remains reserved; host transfer banner; start explains missing readiness.

**Interaction, accessibility and animation:** Copy is announced without reading password; invite modal never auto-copies password; connection has text/icon. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S08 — Card preparation

**Route:** `/rooms/:id/preparing`

**Purpose and visual priority:** Explain dealing and publish fairness commitment.

**Desktop wireframe:** Central card stack with participant ring and checklist: roster frozen, data version, seed commitment, dealing.

**Mobile wireframe:** Compact stack with progress steps and full text alternative.

**Component hierarchy:** `PreparationView > FairnessSummary/DealingProgress/SeatOrder`.

**Primary/secondary actions and navigation:** View rules; copy commitment; reconnect action on failure. No client Deal button.

**Required server data:** Game started/deal events, visible commitment, config.

**Loading, empty, error and connection states:** Real stages only; no fake percentage; failed initialization offers retry via host/server recovery.

**Interaction, accessibility and animation:** Dealing animation≤ 1s; reduced motion static cards; do not reveal undealt player identities. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S09 — Card arena

**Route:** `/rooms/:id/cards`

**Purpose and visual priority:** Make the current category decision and follow ownership.

**Desktop wireframe:** Arena center with revealed cards in 2×2/2×4; selector/clock above; own stats/action rail below; pot and opponent counts at sides.

**Mobile wireframe:** Main revealed card plus swipe-free opponent tabs, comparison list and bottom category buttons; pot count always visible.

**Component hierarchy:** `CardArena > TurnIndicator/VisibleCards/CardTiePot/DeckCounts/CategoryControls/ChatToggle`.

**Primary/secondary actions and navigation:** Selector selects category; others inspect; host end request; leave controls after confirmation.

**Required server data:** PermittedCardSnapshot, comparisonId, deadline, allowed metrics, deck counts.

**Loading, empty, error and connection states:** Pending selection freezes own buttons; stale response refreshes current comparison; offline disables actions with reconnect banner.

**Interaction, accessibility and animation:** Do not move stat rows between rounds; keyboard buttons; countdown announcements at milestones only. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S10 — Card comparison/detail

**Route:** `/rooms/:id/cards?view=comparison`

**Purpose and visual priority:** Understand a category and its data basis.

**Desktop wireframe:** Side panel with all revealed values sorted by seat, winning direction and source details; card zoom at center.

**Mobile wireframe:** Full-height sheet with category rows, close and original arena restored.

**Component hierarchy:** `ComparisonSheet > StatTable/RatingExplanation/SourceLabel`.

**Primary/secondary actions and navigation:** Choose category if authorized; inspect raw stats; close without losing game state.

**Required server data:** Revealed cards only, rating model and provenance.

**Loading, empty, error and connection states:** Unknown raw data displays unavailable; stale comparison header identifies the new round; no auto-submit from sheet close.

**Interaction, accessibility and animation:** Actual table headers and values; rating meaning not color; announce selected category and submit separate from focus. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S11 — Tie-break arena

**Route:** `/rooms/:id/cards?phase=tie`

**Purpose and visual priority:** Show who remains eligible and why the pot grows.

**Desktop wireframe:** Pot dominates center; tied cards foreground; temporarily ineligible players dim but labels readable; original-selector marker.

**Mobile wireframe:** Eligible players and pot above action rail; ineligible counts in collapsed labeled strip.

**Component hierarchy:** `TieArena > EligibilityBanner/CardTiePot/EligibleCards/SelectorControls`.

**Primary/secondary actions and navigation:** Eligible selector selects; others observe. Inspect contribution history; host may request vote.

**Required server data:** Tied IDs, able IDs, contribution order, pot size, chain count, fallback reason.

**Loading, empty, error and connection states:** Exhaustion resolves with clear reason; no blank winner; repeated-tie counter shows cap policy.

**Interaction, accessibility and animation:** Say “Waiting until tie ends” for ineligible users; never render their category controls enabled; reduced-motion pot uses count change. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S12 — Card round victory reveal

**Route:** `/rooms/:id/cards#round-result`

**Purpose and visual priority:** Explain one contest result without blocking the next turn.

**Desktop wireframe:** Nonmodal overlay with winner portrait, selected category and cards gained; pot travels to deck.

**Mobile wireframe:** Compact top banner and count delta; next controls stay in fixed position.

**Component hierarchy:** `RoundWinnerReveal > WinnerLabel/ComparisonResult/CardCountDelta`.

**Primary/secondary actions and navigation:** Skip visual; inspect comparison. No Continue required for engine.

**Required server data:** One resolved eventId and next snapshot.

**Loading, empty, error and connection states:** Duplicates produce no second celebration; reconnect skips historical reveals; no audio-only result.

**Interaction, accessibility and animation:** Animation keyed by event; aria-live single announcement; cancel animation on next authoritative phase. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S13 — Card final results

**Route:** `/rooms/:id/results`

**Purpose and visual priority:** Present final rankings and earned medals.

**Desktop wireframe:** Three-person podium, rank table below, completion reason and fairness audit drawer; remaining result TTL in footer.

**Mobile wireframe:** Winner first then compact2nd/3rd tiles; no phantom third place in two-player game.

**Component hierarchy:** `VictoryPodium > ResultSummary/RankingTable/QualificationStatus/AuditDrawer`.

**Primary/secondary actions and navigation:** Return dashboard; profile; copy nonprivate result text if user chooses.

**Required server data:** ResultDTO, medal receipts status, seed reveal, expiry.

**Loading, empty, error and connection states:** Finalizing skeleton until receipts commit; practice label if threshold unmet; expired result redirects to profile notice.

**Interaction, accessibility and animation:** Skip ceremony, mute, focus results heading; medals labeled earned/pending/none precisely. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S14 — Auction room creation

**Route:** `/play/auction/create`

**Purpose and visual priority:** Choose rule season, format and competitive constraints.

**Desktop wireframe:** Wizard sections:ruleset, franchises, pool, pacing, privacy; sticky purse/squad/RTM summary with source badge.

**Mobile wireframe:** Single-page accordion, sticky Create and summary drawer; distinguish historical/fresh/custom labels.

**Component hierarchy:** `AuctionCreationForm > RulesetPicker/FormatSelector/PoolPicker/TimerFields/RuleSummary`.

**Primary/secondary actions and navigation:** Create; preview complete rules; reset overrides. Changes mark custom and clear official-like badge.

**Required server data:** Published rulesets, data versions, franchise list, rights availability.

**Loading, empty, error and connection states:** Unpublished rulesets unavailable; insufficient pool validator gives exact reason; price units explicit.

**Interaction, accessibility and animation:** Radio groups for format; show retention interpretation limitation before selecting custom retentions. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S15 — Auction room joining

**Route:** `/play/auction/join`

**Purpose and visual priority:** Enter the room before selecting a franchise.

**Desktop wireframe:** Centered secure join panel and brief two-step explanation: room then team.

**Mobile wireframe:** Code/password form with clear distinction from franchise invitation code.

**Component hierarchy:** `AuctionJoin > RoomJoinForm/NextStepHint`.

**Primary/secondary actions and navigation:** Join; back; success routes to franchise selection, not automatic team membership.

**Required server data:** Gated identity, room join response.

**Loading, empty, error and connection states:** Wrong game code shows game mismatch after invite validation; slots count refers to humans vs franchises separately.

**Interaction, accessibility and animation:** Labels “Room code” and “Team invitation” never interchangeable; paste and keyboard submit. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S16 — Franchise selection

**Route:** `/rooms/:id/franchises`

**Purpose and visual priority:** Claim a team or request collaboration.

**Desktop wireframe:** Grid of crest cards with captain, members/slots, readiness; selected team detail pane.

**Mobile wireframe:** Two-column cards collapsing to one at 320px; own selection pinned top.

**Component hierarchy:** `FranchiseSelection > FranchiseCard[]/MembershipSummary`.

**Primary/secondary actions and navigation:** Claim available team; request to join occupied team; leave selection before start.

**Required server data:** Franchise definitions, room teams, member capacities, own status.

**Loading, empty, error and connection states:** Concurrent claim loses cleanly to occupied state; team full explains capacity; stale roster auto-refresh.

**Interaction, accessibility and animation:** Emblems have name text; large hit area; each card separate action label; no color-only franchise identity. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S17 — Collaboration approval

**Route:** `/rooms/:id/team/requests`

**Purpose and visual priority:** Authorize teammates and capabilities.

**Desktop wireframe:** Captain request queue at left; selected requester and explicit permission checkboxes at right.

**Mobile wireframe:** Requests list and full-screen permission sheet; default advisor role.

**Component hierarchy:** `TeamApproval > PendingRequests/CapabilityEditor/InviteCodePanel`.

**Primary/secondary actions and navigation:** Approve/reject; rotate code; configure restricted auto-join; accept handover if targeted.

**Required server data:** Own team join requests, friend allowlist, capability vocabulary.

**Loading, empty, error and connection states:** Pending request survives reconnect; expired/decided by another tab shows canonical outcome.

**Interaction, accessibility and animation:** Explain Bid/Strategy/Invite permissions in plain language; grant preview before save; focus returns to request row. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S18 — Retention management

**Route:** `/rooms/:id/retentions`

**Purpose and visual priority:** Confirm retained identities and actual purse deductions.

**Desktop wireframe:** Eligible previous roster table, selected retained slots at side, purse math footer.

**Mobile wireframe:** Player list with filter, selection chips, sticky cost/confirm; explanations sheet.

**Component hierarchy:** `RetentionManager > EligibleRoster/RetentionSlots/CostBreakdown/ConfirmPanel`.

**Primary/secondary actions and navigation:** Propose; captain lock package; edit until locked/auction start per rules.

**Required server data:** Previous roster, capped tags, cost model, package version, purse reserve.

**Loading, empty, error and connection states:** Over-cap and unverified class block submit; concurrent edits conflict visibly; unknown fact never auto-assumed.

**Interaction, accessibility and animation:** Separate nominal floors, allocated amounts and charged total; factual vs simulator badge; no hidden rounding. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S19 — Auction waiting lobby

**Route:** `/rooms/:id/auction-lobby`

**Purpose and visual priority:** Ensure every team is ready with safe offline settings.

**Desktop wireframe:** Franchise roster rows, retention summary, auto-policy confirmation and host start sidebar.

**Mobile wireframe:** Team readiness list and own strategy checklist; host Start remains accessible.

**Component hierarchy:** `AuctionLobby > FranchiseRoster/RetentionStatus/AutoConsent/StartChecklist`.

**Primary/secondary actions and navigation:** Ready; edit strategy; invite approved teammate; host start; leave.

**Required server data:** Teams, members, locked retention, config version, auto consent.

**Loading, empty, error and connection states:** Incomplete teams block start; disconnected counts distinct from readiness; missing strategy explicitly observe-only.

**Interaction, accessibility and animation:** Readiness cannot be enabled by another team; explain first nomination locks medal roster. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S20 — Live auction stage

**Route:** `/rooms/:id/auction`

**Purpose and visual priority:** Bid safely with full market context.

**Desktop wireframe:** 240px teams rail, center spotlight/current bid+clock,320px history; persistent action bar with max legal next bid and purse.

**Mobile wireframe:** Portrait cropped above fold, current highest bid and timer centered, bid bar fixed; teams/history/chat sheets.

**Component hierarchy:** `AuctionStage > FranchiseRosterPanel/AuctionPlayerSpotlight/AuctionCountdown/AuctionHistory/BidControlPanel`.

**Primary/secondary actions and navigation:** Bid exact displayed next increment; details; squad; public/team chat; host end-vote request.

**Required server data:** NominationDTO, bidVersion, legalNextBid, own purse, reserve, roster, RTM phase, presence.

**Loading, empty, error and connection states:** Submitting state until ack; rejected stale amount never auto-increases; offline disables; voting fully blocks bids.

**Interaction, accessibility and animation:** Primary bid amount announced after changes without stealing focus; controls stay fixed; no accidental double-tap purchase. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S21 — Auction player detail

**Route:** `/rooms/:id/auction?player=:id`

**Purpose and visual priority:** Inspect performance and provenance during bidding.

**Desktop wireframe:** Side drawer with photo, role tags, stat sections, source cutoff and comparisons.

**Mobile wireframe:** Full-screen sheet; compact live bid bar visible only if intentionally enabled, otherwise close-to-bid.

**Component hierarchy:** `PlayerDetail > Identity/Statistics/PhaseSkills/SourceInfo/ComparePicker`.

**Primary/secondary actions and navigation:** Shortlist; recommend max; close. Any bid uses current live controls and version.

**Required server data:** Public player stats/model/source; own shortlist only.

**Loading, empty, error and connection states:** Missing photo uses original silhouette; missing metrics marked estimated; stale player nomination label.

**Interaction, accessibility and animation:** Tabular data and expandable explanations; no motion-only charts; descriptive photo alt. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S22 — Franchise squad management

**Route:** `/rooms/:id/squad`

**Purpose and visual priority:** Track roster legality and planned XI.

**Desktop wireframe:** Player table grouped by role; purse/overseas/minimum requirements side panel; provisional XI below.

**Mobile wireframe:** Role tabs, list rows and sticky deficit summary; expand a player for details.

**Component hierarchy:** `SquadManager > PurseTracker/RoleCoverage/SquadTable/ProvisionalXI`.

**Primary/secondary actions and navigation:** Inspect; filter; propose targets. No selling/trading players after purchase in v1.

**Required server data:** Acquisitions, retentions, legal counts, role tags, provisional algorithm label.

**Loading, empty, error and connection states:** Empty roster gives target needs; roster infeasible warns; final score not shown as guaranteed during auction.

**Interaction, accessibility and animation:** Text deficits (“Need 1 keeper”) not red chips alone; sortable columns announce order. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S23 — Player shortlist

**Route:** `/rooms/:id/shortlist`

**Purpose and visual priority:** Coordinate private targets and ceilings.

**Desktop wireframe:** Pool search left, ranked own-team targets right with max price and notes.

**Mobile wireframe:** Search and target tabs; reorder using up/down controls.

**Component hierarchy:** `TeamShortlist > PlayerSearch/TargetList/RecommendationVotes`.

**Primary/secondary actions and navigation:** Add/remove target; set ceiling if authorized; recommend/vote.

**Required server data:** Own team shortlist/capabilities, public pool; never other-team strategies.

**Loading, empty, error and connection states:** Pending changes versioned; removed authorization closes private view; empty explains advisory nature.

**Interaction, accessibility and animation:** No drag-only priority; max prices hidden from public screen-share mode; vote is explicitly advisory. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S24 — Public auction chat

**Route:** `/rooms/:id/chat/public`

**Purpose and visual priority:** Support friendly room conversation.

**Desktop wireframe:** Right drawer with Public to room header, messages, composer; game remains visible.

**Mobile wireframe:** Full-height sheet with persistent compact live status and close.

**Component hierarchy:** `PublicChat > AudienceLabel/MessageList/Composer/ModerationMenu`.

**Primary/secondary actions and navigation:** Send plain text; report/mute locally; authorized removal.

**Required server data:** Authorized room channel, cursor, own rate/mute status.

**Loading, empty, error and connection states:** Optimistic bubble marked sending until ack; failed retry reuses clientMessageId; rate-limit countdown.

**Interaction, accessibility and animation:** Log role with new-message control; do not auto-scroll if reading history; audience explicitly public to room. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S25 — Private franchise chat

**Route:** `/rooms/:id/chat/team`

**Purpose and visual priority:** Keep team strategy separate and private.

**Desktop wireframe:** Distinct locked team drawer with member avatars and team name, not merely a colored tab.

**Mobile wireframe:** Dedicated sheet titled “Only [team] members”; separate composer draft.

**Component hierarchy:** `TeamChat > PrivateAudienceBanner/ApprovedMemberList/MessageList/Composer`.

**Primary/secondary actions and navigation:** Send; switch public using explicit tab; manage members only if captain.

**Required server data:** Current team membership, private channel, own messages.

**Loading, empty, error and connection states:** Revocation wipes cached private messages and closes sheet; no leak in notifications or public toast.

**Interaction, accessibility and animation:** Announcement of audience on open; separate drafts prevent accidental cross-post; no message preview on lock screen by default. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S26 — Auto mode status

**Route:** `/rooms/:id/auto`

**Purpose and visual priority:** Explain offline decisions and safe return to control.

**Desktop wireframe:** Status panel with active policy, spend cap, purchases during absence and takeover button.

**Mobile wireframe:** Critical banner plus expandable decision list; takeover above list.

**Component hierarchy:** `AutoModePanel > ControlStatus/SpendLimits/MissedPurchases/TakeoverAction`.

**Primary/secondary actions and navigation:** Resume manual; inspect reasons; captain edit permitted policy at safe boundary.

**Required server data:** Control epoch, auto strategy, missed team events, purse.

**Loading, empty, error and connection states:** Takeover pending blocks local bids; old epoch error refreshes; no strategy shows observe-only.

**Interaction, accessibility and animation:** Reason text e.g. “Skipped: reserve for 4 players”; no claim AI if deterministic rules. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S27 — Auction results and analysis

**Route:** `/rooms/:id/results`

**Purpose and visual priority:** Explain the winning squad and eligible shared medals.

**Desktop wireframe:** Podium with franchise, leaderboard, component score bars, recommended XI and weaknesses tabs.

**Mobile wireframe:** Winner summary then rank list; component table and XI vertically stacked.

**Component hierarchy:** `AuctionResults > VictoryPodium/FranchiseLeaderboard/ScoreBreakdown/RecommendedXI/MemberCredits`.

**Primary/secondary actions and navigation:** Return dashboard; profile; inspect model and qualification; compare teams.

**Required server data:** Exact evaluation result, legal status, team credits, TTL, model version.

**Loading, empty, error and connection states:** Progress while evaluating; incomplete teams show no-medal reason; no winner if all invalid.

**Interaction, accessibility and animation:** Charts have numeric tables; score described as game model; team medal count not number of competing humans. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S28 — End-game voting

**Route:** `modal over current room`

**Purpose and visual priority:** Offer an exactly15-second democratic decision.

**Desktop wireframe:** Centered480px modal with question, server deadline, threshold and two equally clear options; frozen game visible underneath.

**Mobile wireframe:** Full-width bottom sheet with 44px targets and clear current vote; backdrop prevents game actions.

**Component hierarchy:** `VoteCountdownModal > ElectorateSummary/Countdown/EndButton/ContinueButton/RecordedChoice`.

**Primary/secondary actions and navigation:** One immutable vote; no auto-Yes from host; spectators observe; resolve returns saved phase or results.

**Required server data:** VoteDTO, canVote, representative, expiresAt, serverNow; no interim public tally.

**Loading, empty, error and connection states:** Refresh restores same vote; at expiry disable; network pending distinguishes recorded/unconfirmed; result toast.

**Interaction, accessibility and animation:** Focus trap; countdown milestones; can close visual to inspect paused game but cannot resume actions; reopen persistent vote banner. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S29 — User profile

**Route:** `/players/:username`

**Purpose and visual priority:** Show identity, privacy and earned achievements.

**Desktop wireframe:** Avatar/name hero, three medal counters, game totals and compact receipt gallery; friends/action sidebar.

**Mobile wireframe:** Compact identity, counter row, achievement list, privacy edit sheet for owner.

**Component hierarchy:** `ProfileOverview > Identity/MedalStats/AchievementGallery/FriendActions`.

**Primary/secondary actions and navigation:** Edit own; request/remove friend; block; view permitted achievements.

**Required server data:** ProfileDTO, summary, compact receipts, relationship; no full match replay.

**Loading, empty, error and connection states:** Private profile explains access; zero medals says play qualifying games; deleted user generic tombstone.

**Interaction, accessibility and animation:** Gold/silver/bronze text labels; team/personal attribution; never badges from client local counts. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S30 — Friends interface

**Route:** `/friends`

**Purpose and visual priority:** Manage connections and privacy-respecting invitations.

**Desktop wireframe:** Three tabs Friends/Requests/Find; list with presence privacy and invite buttons.

**Mobile wireframe:** Single column search, list, context menus; request count badge.

**Component hierarchy:** `FriendsPage > Search/FriendList/RequestPanel/InvitePicker`.

**Primary/secondary actions and navigation:** Request, accept, reject, remove, block, invite to existing permitted room.

**Required server data:** Relationship DTOs, permitted activity, own active rooms.

**Loading, empty, error and connection states:** Empty search starts only≥ 3 chars; pending errors not duplicate; blocked users absent.

**Interaction, accessibility and animation:** Invite names room but no password; confirmation for remove optional undo; keyboard list actions. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S31 — Notifications center

**Route:** `/notifications`

**Purpose and visual priority:** Collect invitations, friend updates and announcements.

**Desktop wireframe:** Header popover plus dedicated page, unread filter and grouped dates.

**Mobile wireframe:** Full-screen list; touch actions mark read.

**Component hierarchy:** `NotificationCenter > Filter/NotificationList/ActionLink`.

**Primary/secondary actions and navigation:** Read; accept invite through normal join flow; open friend request.

**Required server data:** Own notifications, room invite TTL and target access status.

**Loading, empty, error and connection states:** Expired invitations disabled with explanation; deleted room link does not loop; loading pages cursor-based.

**Interaction, accessibility and animation:** No private chat body previews; unread uses text/state not color only; link destination clear. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S32 — Administrator login

**Route:** `/admin/login`

**Purpose and visual priority:** Authenticate administrators independently for access recovery.

**Desktop wireframe:** Quiet centered form without game art; institutional label, email/password then TOTP challenge.

**Mobile wireframe:** Single-column form; no hidden MFA step on small screens.

**Component hierarchy:** `AdminLogin > Credentials/MFAChallenge/SessionNotice`.

**Primary/secondary actions and navigation:** Sign in; verify MFA; recover via approved operator process.

**Required server data:** Minimal admin login challenge, assignment verification; no role selector.

**Loading, empty, error and connection states:** Generic unauthorized error; AAL1 cannot load dashboard; throttled login shows cooldown.

**Interaction, accessibility and animation:** Password manager compatible; TOTP autocomplete one-time-code; no admin role in client request. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S33 — Administrator dashboard

**Route:** `/admin`

**Purpose and visual priority:** Monitor operations and manage restricted configuration.

**Desktop wireframe:** Left220px sidebar, overviewcards, room status table and operations queue.

**Mobile wireframe:** Sidebar drawer, stacked metrics, table summary rows; critical failures top.

**Component hierarchy:** `AdminShell > HealthOverview/ActiveRoomTable/CleanupQueue/AuditPreview`.

**Primary/secondary actions and navigation:** Inspect health; open Access/Players/Cards/Auction/Users/Announcements/Operations.

**Required server data:** Admin aggregate metrics, active rooms, safe audit fields.

**Loading, empty, error and connection states:** Stale health badge with timestamp; partial unavailable widgets; no fake live counts.

**Interaction, accessibility and animation:** Operational status text; charts have data tables; no default private team chat or undealt-card view. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S34 — Game/data configuration management

**Route:** `/admin/catalog`

**Purpose and visual priority:** Publish reviewed versions without code changes.

**Desktop wireframe:** List/filter of drafts and published versions; editor, diff/source/rights sidebar; publish checklist footer.

**Mobile wireframe:** Draft list to single-column editor; source/validation sections accordion; sticky Save draft.

**Component hierarchy:** `CatalogAdmin > VersionList/SchemaForm/SourceEditor/RightsPanel/ValidationDiff/PublishAction`.

**Primary/secondary actions and navigation:** Import, edit draft, validate, publish, archive; access management rotates code with step-up and revocation choice.

**Required server data:** Draft schemas, source provenance, rights, validation errors, config version.

**Loading, empty, error and connection states:** Row-level import errors; immutable published edit creates new draft; conflict never overwrites; publish blocked on missing evidence.

**Interaction, accessibility and animation:** Diff text explains affected future games; secret field blank on load; no reveal of stored access code. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

### S35 — Error, maintenance and disconnection

**Route:** `global overlays and /status`

**Purpose and visual priority:** Keep users informed and prevent unsafe actions during disruption.

**Desktop wireframe:** Persistent top status banner; action area disabled as needed; main state remains legible; retry/resync panel.

**Mobile wireframe:** Compact banner above fixed action rail; no full-screen spinner hiding last confirmed bid.

**Component hierarchy:** `ConnectionBoundary > StatusBanner/RetryPanel/LastConfirmedState/RecoveryCountdown`.

**Primary/secondary actions and navigation:** Retry; reverify; return dashboard; regain control after state sync.

**Required server data:** Connectivity FSM, last ack, cursors, server recovery reason, gate status.

**Loading, empty, error and connection states:** Connecting/reconnecting/recovering/reauth/maintenance/closed distinct; backoff visible; no optimistic purchases.

**Interaction, accessibility and animation:** Assertive announcement once on control loss; polite recovery; offline status never reported as a lost game. Apply the shared motion/reduced-motion contract; important decisions never wait for an animation.

## 6. Frontend component ownership

Server state has one owner: a room session reducer/store per current room with typed permitted snapshot plus independent stream cursors. Socket handlers dispatch validated events into it. TanStack Query owns HTTP resources such as catalog, profile and friend lists; room snapshots are handed to the room store once, not kept in competing independently mutable caches. Zustand (or a small useSyncExternalStore implementation) may own the room projection; use one documented approach, not both. Choose Zustand for v1. Local React state owns drawers, animation progress, text drafts and filters. Derived purse/score displayed values come from the canonical projection, never manually adjusted local counters.

| Major component | Props / server dependency | Internal UI state | Events and accessibility |
|---|---|---|---|
| AccessGate | AttemptStatus, onSubmit | input visibility, submission pending | onVerify; input labels, lockout live region |
| GameSelectionCard | game, title, licensedArtwork, href | hover/focus only | navigation; whole tile semantic link |
| MultiplayerLobby | RoomLobbyDTO, capabilities | invite/settings sheets | ready/start/leave intents, roster live updates |
| PremiumCricketCard | PublicCardDTO, size, revealed, reducedMotion | flip progress only | inspect; semantic textual sibling, art decorative |
| CardStatComparison | visibleCards, allowedMetrics, canSelect | focused metric | category intent, table keyboard support |
| CardTiePot | count, visibleContributions, lastEventId | travel animation queue | inspect; count label, skip animation |
| TurnIndicator | selector, deadline, serverOffset | display-only clock | no authoritative timeout callback; milestone announcements |
| FranchiseSelectionCard | publicFranchise, membershipStatus | request dialog | claim/join, accessible availability |
| AuctionPlayerSpotlight | PlayerPublicDTO, nominationId | details expansion | inspect; image fallback |
| BidControlPanel | legalNextBid, ownPurse, reserve, capabilities, bidVersion | pending command ID only | bid intent; rejection reason, stable targets |
| AuctionCountdown | deadline, paused, offset | rendered seconds | no sell mutation; reduced motion |
| PurseTracker | committedPurse, reserve, standingCommitment | tooltip | text numbers and units |
| AuctionHistory | permitted ordered events | scroll position | inspect player; virtualize after 100 rows |
| TeamChat/PublicChat | channel projection, permissions | separate draft per channel | send/remove, plain text, safe audience labels |
| VoteCountdownModal | VoteDTO, canVote, myVote | pending receipt, open state | vote intent; focus trap; one submission |
| VictoryPodium | ResultDTO, qualifiedMedals | ceremony progress, mute | skip/dashboard; no medal calculation |
| ProfileOverview | ProfileDTO, summary, relationship | edit dialog | profile save/friend request; no arbitrary fields |
| FriendRequestPanel | requests, loading | action pending IDs | accept/reject once; keyboard actions |
| AdminSidebar | verified admin capabilities | collapsed state | links; not authorization boundary |

Route groups: `(public)` gate/auth/legal, `(member)` dashboard/social, `(room)` lobby/game/results, `(admin)` admin login/protected area. Protected server layouts validate session for initial request; every API/command repeats authorization. A route guard alone is insufficient. Dynamic imports separate card and auction views. Use Zod-inferred DTOs shared with backend; package exports prohibit importing `packages/game-engines` or DB/server secrets into web code. Use server-only markers for BFF/auth modules.

## 7. Practical art and asset production brief

Create six distinct frame SVG/CSS compositions with original geometry; no image generation is needed for precise stat/text layouts. Player art is an optional licensed raster layer with consistent cutout crop and neutral lighting. Request separate art assets later if needed; this planning task does not generate player likenesses or official emblems. Original fallback uses illustrated fictional cricketers in sponsor-free kits, geometric city emblems and source-labeled demonstration names. Low bandwidth mode uses static portraits and CSS frames, no video backgrounds. Store AVIF/WebP variants at 320/640/960 widths with dimensions, lazy-load noncritical images, prefetch only next visible artwork, and never preload hidden future deck identities.

Hero imagery budget≤ 250KB per game tile; current player portrait target≤ 150KB; combined initial dashboard transfer target≤ 1.5MB on compressed desktop and≤ 800KB low-data mode. These are test targets, not measured results. Do not use arbitrary remote image URLs in Next image optimization; allowlist controlled Storage origins and validate uploaded image content.

## 8. Design acceptance and review

Review at 360×800,390×844,768×1024,1024×768,1440×900 plus320px reflow,200% zoom and keyboard-only use. Capture all 35 screens, including error/reconnecting/empty variations. Test long player names, two-player names, large rupee amounts, zero cards, maximum pot, full25-player squads and60 human collaborators. The first action must remain visible with iOS safe-area and keyboard open. All errors should name the next available action. A11y tests use axe plus manual screen-reader checks; automated checks alone do not certify compliance.

A visual release is blocked by clipped bids, unreadable card stats, hidden warning text, misleading team chat labels, layout shift moving action targets, unclear pending purchase state, or animation delaying controls. Visual polish is a separate acceptance gate from transaction correctness; both must pass.
