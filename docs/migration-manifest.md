# Migration manifest and retention ownership map

Design artifact from phase 00 (no database writes). Source: DB/realtime §5–§6, §11. All tables live in schema `app_private`; browser roles `anon`/`authenticated` have no usage on it (class **B** for every table). Each feature migration creates its RLS policy and grants in the same file; `090` only verifies/reconciles. Migrations are applied by CI/`pnpm db:reset` with a migration identity, never by server startup.

Retention classes: **P** persistent catalog/profile · **S** security with explicit TTL · **O** bounded operational · **T** temporary room scope (cascade from `rooms`).

## Migration order

| Migration | Phase | Tables / objects |
|---|---|---|
| `000_extensions_roles_schema` | 2 | (schema app_private, roles app_runtime/app_admin_runtime, Supabase shim if absent), app_config |
| `010_profiles_security` | 2–3 | profiles, admin_assignments, access_config, access_attempts, access_request_receipts, gate_grants, enrollment_invites, app_sessions, socket_tickets, request_receipts, security_events, admin_audit, runtime_leases, announcements |
| `020_catalog` | 2, 6 | data_sources, seasons, franchises, season_franchises, players, player_external_ids, player_seasons, data_versions, player_statistics, player_ratings, media_assets, card_definitions, card_players, auction_rulesets, auction_pool_entries |
| `030_social_achievements` | 2, 13–14 | friendships, user_blocks, notifications, achievement_receipts, achievement_summaries |
| `035_access_auth` | 3 | admin_assignments.mfa_enrollment_until, rate_counters, access_config.rotated_at |
| `040_rooms_streams_deadlines` | 5 | rooms, room_members, room_invites, room_connections, room_commands, room_streams, room_events, deadline_jobs, host_handovers |
| `045_catalog_media_ratings` | 6 | catalog_imports; alters players, player_seasons, media_assets (free-license evidence), data_versions, card_definitions |
| `046_ipl_kit_photos` | 6 | alters media_assets (`ipl_kit` attestation, ADR-019) |
| `050_card_engine` | 7–8 | card_games, card_seats, card_instances, card_comparisons, card_contributions, card_cycle_counts |
| `052_card_ties` | 8 | adds card_comparisons.fallback (tie fallback audit) and card_games.pending_reason (end waiting for the chain; consistent with finish_pending) (ADR-023) |
| `053_rating_ceiling` | 8 | widens card_contributions.metric_points to 0–1010 so an owner override (Sachin Tendulkar Gold, display 101) can be compared (ADR-022 amendment) |
| `051_attax_card_stats` | 7 | alters card_definitions (ratings: batting, bowling, runs) and card_comparisons (metric) checks; new rows only (ADR-022) |
| `060_auction` | 9 | auction_games, auction_franchises, franchise_members, franchise_invites, franchise_join_requests, auction_pool, retention_packages, auction_acquisitions; pool-entry facts (overseas, role, current salary, price source); deferred purse-conservation and captain-pointer triggers (ADR-024). Nominations, bids, handovers, strategies and shortlists follow in phases 10–12 as later migrations. |
| `070_auction_bidding` | 10 | auction_nominations (one open lot per room, stages, deadline, timer generation, RTM fields, sale), auction_bids (accepted offers only, UQ nomination/bid_version), pool bowl type and skip flag, game seed commitment, pauses, end reason; acquisition → lot foreign key (ADR-025) |
| `070_votes_chat_assets_results_cleanup` | 13–15 | end_votes, vote_electorate, chat_channels, chat_mutes, chat_messages, room_assets, room_results, cleanup_tasks |
| `080_invariants` | 7–15 (added per feature migration) | (deferred constraint triggers: card conservation, purse sums, single captain, medal mapping) |
| `090_rls_grants_verify` | 2 (rerun every phase) | (reconcile/verify every table: RLS enabled+forced, backend policy, grants, no browser access) |
| `100_indexes_seed` | 2+ | (secondary indexes; demo/reference seed lives in supabase/seed, not migrations) |

Phase 02 delivers files numbered `000`–`030` exactly as the phase 02 prompt requires; later phases add their own numbered files (`040`+). If a later phase needs to change an earlier table it adds a new forward migration rather than editing an applied one.

## Implemented deviations from the spec dictionary (phase 02)

| Table | Change | Reason |
|---|---|---|
| `profiles` | added `onboarded_at` | A profile row (temporary username) must exist when the gate grant binds at first sign-in (`gate_grants.user_id → profiles`); onboarding (S03) sets the real username and this timestamp |
| `app_sessions` | added `gate_grant_id`, `aal`, `step_up_at` | Gate binding, admin AAL2 and 5-minute step-up checks are enforced from server state |
| `player_seasons` | keyed by `(data_version_id, player_id)` instead of `(player, season)`; added `portrait_asset_id` | Published snapshots must be immutable per data version; portrait per version (ADR-017) |
| `players`, `franchises` | added `is_fictional`; franchises add `short_name`, `secondary_hex` | DEMO labeling and original crest rendering |
| `media_assets` | added `purpose`, `width`, `height`, `variant_widths`, `rights_basis`, `alt_text` | Portrait pipeline with WebP variants and descriptive alt text |
| `data_versions` | added `kind`, `derived_from` | Demo vs factual packs; correction lineage |
| `auction_rulesets` | added `data_version_id`, `published_at` | A ruleset pool resolves player facts/portraits from one frozen data version |
| `auction_pool_entries` | added `set_label` | Published role/base-price sets for nomination order |
| `access_config` | `code_hash` nullable | Gate is closed (fail-closed) until an operator sets the first code |

Database-enforced invariants added: published data versions/rulesets and all their child rows are immutable (triggers); dual cards have exactly two players and other rarities one (deferred constraint trigger); receipts' medal ↔ place mapping and `medal ⇒ qualifies`; runtime role cannot insert `admin_assignments`, update/delete receipts, or run DDL.

## Retention ownership map

| Table | Class | TTL / deletion owner | Owner module |
|---|---|---|---|
| `profiles` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | profiles |
| `admin_assignments` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | admin |
| `access_config` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | access-gate |
| `app_config` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | admin |
| `announcements` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | admin |
| `players` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `player_external_ids` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `seasons` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `franchises` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `season_franchises` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `player_seasons` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `data_sources` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `data_versions` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `player_statistics` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `player_ratings` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `media_assets` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `card_definitions` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `catalog_imports` | O | 1 year of import history, then delete; never referenced by gameplay | cricket-data |
| `card_players` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `auction_rulesets` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `auction_pool_entries` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | cricket-data |
| `friendships` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | friends |
| `user_blocks` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | friends |
| `achievement_receipts` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | achievements |
| `achievement_summaries` | P | Persistent; catalog versions archived, never deleted while referenced; account erasure for user-owned rows | achievements |
| `access_attempts` | S | 24h after window expiry | access-gate |
| `access_request_receipts` | S | 24h | access-gate |
| `gate_grants` | S | purge ≤24h after expiry | access-gate |
| `enrollment_invites` | S | expire 1h, delete ≤24h | auth |
| `app_sessions` | S | delete revoked/expired after 24h | auth |
| `socket_tickets` | S | delete ≤5 min | realtime/tickets |
| `rate_counters` | S | 24h maximum window; swept by security-cleanup job | access-gate/auth |
| `request_receipts` | S | 24h or room deletion | transaction |
| `notifications` | O | max 30 days | friends/notifications |
| `admin_audit` | O | 90 days | admin |
| `security_events` | O | 30 days | observability |
| `runtime_leases` | O | overwrite stale | jobs |
| `rooms` | T | Root; deleted last by cleanup after assets absent | rooms/realtime |
| `room_members` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `room_invites` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `room_connections` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `room_commands` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `room_streams` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `room_events` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `deadline_jobs` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `host_handovers` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | rooms/realtime |
| `card_games` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `card_seats` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `card_instances` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `card_comparisons` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `card_contributions` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `card_cycle_counts` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cards |
| `auction_games` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auction_franchises` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `franchise_members` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `team_handovers` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `franchise_invites` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `franchise_join_requests` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auction_pool` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auction_nominations` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auction_bids` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auction_acquisitions` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `retention_packages` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `auto_strategies` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `team_shortlists` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `shortlist_votes` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | auctions/teams |
| `end_votes` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | voting |
| `vote_electorate` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | voting |
| `chat_channels` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | chat |
| `chat_mutes` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | chat |
| `chat_messages` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | chat |
| `room_assets` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cleanup |
| `room_results` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cleanup |
| `cleanup_tasks` | T | Cascade with room root after Storage prefix verified empty (cleanup module) | cleanup |

Counts: 24 P, 7 S, 4 O, 37 T tables.

## Deletion proof contract (phase 15)

`scripts/audit-room-deletion.ts` iterates **every T table above** (the schema registry) and requires `count(*) WHERE room_id = $1` = 0 (or `id = $1` for `rooms`), plus an empty Storage prefix `rooms/{roomId}/`, while profiles, friendships and achievement receipts remain.
