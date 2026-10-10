# ADR-019: Strict card data and licensed photos of players in IPL jersey

- **Status:** Accepted (product-owner requirement, 10 October 2026). Amends ADR-017 and ADR-018.
- **Requirement:** "No data on the card must be shown as estimated or empty; they must have the value for sure. The images of the players in IPL jersey must be present on every card and auction game strictly."
- **Operator statement:** the game is private, for the founders of the operating startup. They state that they hold the licence and permission to collect the player images and build the product.

## Decision

### 1. Every value is definite
There is no "estimated" value, no provisional star cap and no completeness percentage anywhere: not in the engine, the database, the DTOs or the UI. This replaces the ADR-018 rule "missing data uses the prior and an estimated tag".
- **Ratings** (`packages/game-engines/src/ratings/v1.ts`): every rating is computed from the player's own observed numbers. The exposure shrinkage of rules §3.2 still applies to small samples, but the result is a real value, not a placeholder.
  - Zero exposure gives a definite **0**. For example, a non-bowler shows bowling 0 and, in the detail, "Does not bowl (0 overs)".
  - Form is computed from the player's own recent matches.
- **Detail statistics** show exact numbers:
  - batting average "X runs, never dismissed" when the player was never out;
  - "0.00 (did not bat)" when they did not bat.
- **Facts are required for every card player:** country, batting style, and bowling style for anyone who bowled a legal ball. Cricsheet does not supply these, so they come from the player sheet (below) or the S34 editor.

### 1a. Ratings reward proven ability (amends rules §3.2 shrinkage)
On the real IPL 2024–2026 data, the plain §3.2 shrinkage pulled tiny samples toward the cohort mean. That mean is dominated by top-order batters, so a tail-ender who scored 0 off 2 balls (Hazlewood) rated 48–72 as a batter, ahead of genuine lower-order batters. Two changes fix this, and both are exact and deterministic:
- **Shrinkage prior:** the prior is now the pooled rate of the cohort's low-exposure players (fewer than 120 effective balls) instead of the whole-cohort mean. Low exposure is itself evidence in T20.
- **Credibility weight:** each discipline index is multiplied by `n/(n+120)`, where n is the player's effective balls, before the rank rescale. A cameo cannot outrank a real record, and the best player in each discipline is still exactly 100.

Result on the real pack:
- **Batting:** Kohli, Sai Sudharsan, Gill, KL Rahul and Klaasen top the list.
- **Bowling:** Bhuvneshwar, Archer, Holder, Hazlewood and Rabada top the list.
- **Tail-enders:** Hazlewood bats 3 and Chahal 0.

A unit test locks this in: no tail-ender with 12 or fewer balls faced may outrank any batter with 300 or more.

### 1b. Fact sources
`pnpm data:facts` fills only missing facts and never overwrites existing values or reviewed names:
- **Full name:** Wikidata, matched by ESPNcricinfo ID (P2697).
- **Country:** the cricket nation (P1532), or else a single citizenship (P27). When several citizenships exist and none is a cricket nation, the country is left for the sheet.
- **Batting and bowling style:** the English Wikipedia "Infobox cricketer".

Players that no source covers are listed for the player sheet.

### 2. Photo of the player in IPL jersey on every card
- `media_assets.ipl_kit` (migration 046) records that the photo shows the player in an IPL franchise jersey. A CHECK constraint forbids setting it on generated illustrations.
- When several photos are approved, the server prefers the IPL-kit one.

### 2a. Official IPL headshots under the operator's licence
The product owner chose the official IPL player headshots (players in franchise jersey) as the photo source and states the startup holds the licence for them.

`pnpm data:headshots -- --licence "<reference>" --holder "<holder>" [--credit "<line>"]` imports them:
- **What it fetches:**
  - only the ten constant squad pages on `www.iplt20.com`;
  - headshot images only from `documents.iplt20.com`, through the player-sheet path (re-encode, metadata stripped, private storage, `ipl_kit = true`, licence and audit row).
- **Matching** is strict and one-to-one:
  - an exact normalised full name, or initials plus surname within the same franchise;
  - a tie or a miss is reported, never guessed.
- **Licence details:** the licence reference and holder are required arguments with no defaults. They are recorded on every photo, and the credit line is shown in the card detail.
- **Players without a headshot:** players in the pack but not in a current squad (for example, retired) get no headshot. They are supplied through the player sheet or dropped at publish with "publish without incomplete cards".

### 3. Publish gate
A data version cannot be published while any card player has a gap. The gaps and their problem codes:

| Code | Gap |
| --- | --- |
| `NO_PHOTO` | no approved, unexpired photo |
| `NOT_KIT` | photo not confirmed as IPL jersey (factual packs) |
| `NO_COUNTRY` | no country |
| `NO_BATTING` | no batting style |
| `NO_BOWLING` | bowled but has no bowling style |

- The admin may choose "publish without incomplete cards". The number of dropped cards is reported.
- The fictional demo pack uses original illustrations, so it is exempt from `NOT_KIT` only. Every other rule still applies to it.
- **Auction lots** (phases 09–10) use the same gate: a player with a gap cannot enter an auction pool.

### 4. Supplying licensed photos and facts: the player sheet
- **Template.** The admin catalog (draft versions) downloads a pre-filled CSV. `pnpm data:profiles -- --template out.csv` produces the same file. Its columns:
  `player_key,name,team,role,full_name,country,batting_style,bowling_style,photo,ipl_jersey,licence,licence_holder,attribution,source_url`.
- **Photo rows.** A row with a photo must state `ipl_jersey = yes`, a `licence` (for example the agreement reference) and a `licence_holder`. These are stored per photo, together with the credit line shown to players.
- **Photo locations:**
  - an https URL on a host listed in `PHOTO_IMPORT_HOSTS` (the operator's licensed source; no other host is ever fetched, redirects are refused, 15 MiB maximum);
  - a file in a local folder, for the CLI `--photos-dir` option only, with path traversal blocked.
- **Processing.** Photos go through the same media pipeline as before (decoded, 3:4 crop, WebP re-encode, metadata stripped, private storage).
- **Errors.** Rows with errors are reported line by line and never half-applied.
- **Admin upload.** The S34 single-photo upload requires the jersey confirmation and the licence fields.

## Consequences
- A real-data pack cannot be published until the operator supplies a licensed IPL-jersey photo and the facts for each player kept in the pack. The admin players table lists exactly what each player is missing.
- The Wikimedia Commons importer (ADR-018) registers photos only as unconfirmed candidates (`ipl_kit = false`). In the first real run, all four photos it labelled "IPL" from their descriptions showed casual wear or off-field events. Only a person can confirm the jersey, through the player sheet.
- The platform records the operator's licence evidence. The operator remains responsible for the rights they state they hold.
