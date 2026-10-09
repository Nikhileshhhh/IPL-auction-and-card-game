# ADR-017: Player portraits are mandatory on cards and auction lots

- **Status:** Accepted (product-owner requirement, 9 October 2026)
- **Requirement:** "The images of the players must be present on their cards during the card game and in the IPL auction game."

## Context
The UI spec places the portrait in the upper 55% of every card and in the auction spotlight, but DTOs mark `portraitUrl` optional and the master plan forbids reproducing IPL/franchise photos without a license (S05, S06; master §3 asset routes A/B).

## Decision
1. `portraitUrl` is **required** in `PublicCardPlayer` and `PlayerPublicDTO`. Publishing a data version fails (`PUBLISH_BLOCKED`) if any card player or auction pool entry lacks an approved portrait asset (`media_assets.rights_status = 'approved'`).
2. Demo pack (route B): every fictional player receives an **original, deterministically generated illustrated portrait** (seeded by player ID: skin tone, hair, kit colors from the fictional franchise, pose) rendered to WebP at 320/640/960 px, labeled DEMO, stored with a rights record `original-generated`.
3. Licensed real photos (route A): administrators upload PNG/JPEG/WebP ≤ 2 MiB through the catalog admin (S34); the server decodes, re-encodes to WebP variants, strips metadata, records source/licence/attribution/expiry, and the new data version's cards and pool entries then show those photos with no code change. No remote URL fetching or scraping.
4. Rendering: `PremiumCricketCard` (all six rarities; dual cards split diagonally with both portraits), the card arena, tie pot, round-winner reveal, auction spotlight, player detail drawer, squad lists, RTM panel and results XI all render the portrait. A broken image falls back to the original silhouette asset and logs a client metric; it is never silently omitted.

## Consequences
- Tests assert every fixture card and pool entry resolves to a portrait asset, and component tests assert the `<img>` is rendered for every card size and rarity.
- Using real IPL player photos requires the operator to hold the rights; the platform records evidence but cannot grant them.
