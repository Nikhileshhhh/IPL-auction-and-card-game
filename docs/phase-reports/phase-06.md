# Phase 06 report — Cricket data, original cards, real photos and admin publishing

**Date:** 2026-10-10 · **Result:** complete in code and tests. Real-data import is **blocked by network policy** (see Known gaps).

Product-owner requirements added this phase (ADR-018):
- real player photos on cards and auction lots;
- ratings computed from real statistics;
- Attax-style ratings where the top batter shows **100 batting** and the top bowler **100 bowling**.

## Migration
`045_catalog_media_ratings`. The manifest reserves `050` for the card engine.
- `players.country_code` becomes nullable (unknown means "Not available").
- `players` gains a `role_reviewed` flag.
- `player_seasons` gains `role` and `team_name`; `overseas` becomes nullable.
- `media_assets` gains the `free-license` rights basis, with licence, author and source page as required evidence, a content hash, the player link and review columns.
- `data_versions` gains `window_label`, `ratings_model` and `validation_report`.
- `card_definitions` gains `card_key`, `completeness_permille` and `estimated`.
- New `catalog_imports` table with FORCE RLS.

## Changed paths
- **Engines** (`packages/game-engines/src`):
  - `cricket/{cricsheet,aggregate}.ts`: Cricsheet JSON parsing to per-player-season counts, phase splits and match lines.
  - `ratings/{rational,v1,catalog}.ts`: exact bigint rationals; the rules §3.2/3.3 model with the ADR-018 rescale; stars; roles; rarity tiers; dual cards; deal allocation; pool check.
  - `demo/league.ts`: deterministic fictional league in Cricsheet format.
- **Server** (`apps/server/src`):
  - `modules/cricket-data/{sources,import,validate,publish,read,service}.ts`: Cricsheet and demo bundles, draft import, validation, publish/prune/archive/discard, catalog reads, background import jobs.
  - `modules/media/{pipeline,storage,service,admin,commons}.ts`: sniff → decode → 3:4 attention crop → WebP 320/640/960 with metadata stripped; local and Supabase storage; portrait serving; admin upload and review; Wikimedia Commons/Wikidata photo finder.
  - `routes/v1/catalog.ts`.
  - Env: `MEDIA_*` and `CRICSHEET_DIR`. Production requires Supabase storage.
- **Web** (`apps/web`):
  - Cards: `components/cards/{PremiumCricketCard,PortraitImage,CardDetail,CardCollection}.tsx`.
  - Admin: `components/admin/CatalogAdmin.tsx`.
  - Pages: `/play/cards/collection` (S08 preview and pool), `/admin/catalog` (S34).
  - BFF portrait proxies: `/api/media/…` and `/api/admin-media/…`.
  - Original rarity frames in `globals.css`; the silhouette fallback asset.
- **Scripts:**
  - `pnpm data:fetch` downloads Cricsheet and writes a ledger.
  - `pnpm data:photos` imports free-licence photos from Commons.
  - `pnpm data:demo` publishes the demo pack (also used by the E2E setup).
- **Contracts:** `packages/contracts/src/catalog.ts`; HTTP and DTO catalogs (84 operations).
- **Docs:** ADR-018, source register (S07/S25 implemented; S27 Wikidata and S28 Commons added), licences, traceability.

## Checks actually run
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass (84 HTTP operations) |
| `pnpm test:unit` | pass (99) |
| `pnpm build` | pass |
| `pnpm db:reset` / `pnpm db:lint` | pass (7 migrations, 46 tables) |
| `pnpm test:integration` | pass (74, including 12 catalog tests) |
| `pnpm test:security` | pass (43) |
| `pnpm test:concurrency` | pass (7) |
| `pnpm test:e2e` | pass (36; 4 desktop-only skipped on mobile) |
| `pnpm data:fetch` | **failed: cricsheet.org blocked** by the environment network policy (proxy 403) |

## Verified behaviour
- **Cricsheet aggregation.** A hand-built match covers wides, no-balls, leg-byes, catches, run-outs, stumpings, a super over, not-outs and the contribution metric, all against exact expected counts.
- **Ratings:**
  - Results are deterministic and independent of input order.
  - The top batter is exactly 100 and the top bowler exactly 100.
  - A non-bowler is 0. Missing data stays null or is tagged "estimated".
  - Stars carry a provisional cap. Role overrides from the editor are respected.
  - Dual cards are the mean of both players, capped at 95.
  - Rarity is visual only.
  - Largest-remainder deal counts are correct, and `POOL_INSUFFICIENT` shortages are reported.
- **Publishing:**
  - A published version is immutable (DB trigger), and re-publishing returns `STATE_CONFLICT`.
  - A factual version is blocked without photos (`PUBLISH_BLOCKED`). Publishing with prune keeps only cards that have approved photos.
  - The factual pack is preferred over the demo pack.
- **Media:**
  - Polyglot, SVG and HTML uploads are rejected. EXIF/GPS is stripped. Variants are exactly 3:4 WebP.
  - Path traversal is rejected.
  - Bytes are served only to signed-in members, as `private` responses.
  - A revoked photo returns 404 immediately.
  - Admin routes are not reachable with a member session.
- **UI:**
  - In the browser, every card shows its photo(s): two for dual cards.
  - Ratings are whole numbers 0–100.
  - The S10 detail shows raw statistics with their scope, "Not available" for unknown facts, phase ratings and photo credits.
  - axe finds no serious violations. There is no horizontal scroll at 360 px.
  - The admin flow (import, then upload with rights evidence) works and the card preview shows photos.

## Known gaps / blockers
- **Real data and photos need network access.**
  - **What is blocked:** this environment's policy denied cricsheet.org, query.wikidata.org, commons.wikimedia.org and upload.wikimedia.org.
  - **To unblock:** allow those hosts (environment settings → Network access → Allowed domains), then run `pnpm data:fetch`, the admin "Import IPL data", `pnpm data:photos`, review, and publish.
  - **Verification so far:** the pipeline is proven on a Cricsheet-format fixture. No real statistics or photos have been imported yet, and none are faked.
- **Photo coverage.** Not every player has a freely licensed photo in IPL kit. The editor lists missing photos for upload by rights holders.
- **Auction lots** show photos once the auction UI ships (phase 10). The same `portraitUrl` contract and publish gate already apply.
- **Phase-specific ratings** are stored for the auction evaluator (phase 14). Cards display the six main ratings.

## Next phase
Phase 07 — card engine (RNG, fair deal, round reducer, invariants) and the card arena.
