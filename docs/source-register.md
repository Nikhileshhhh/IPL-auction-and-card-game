# Source register

Spec version 1.0. Source IDs S01–S26 are defined in the master plan §2.1; this register tracks their **implementation status**. "Checked" dates come from the specification (9 October 2026); this repository has not re-fetched them. Any rule that depends on a source must cite its ID in code comments or ruleset `source_manifest`.

| ID | Source (abbreviated) | Used by | Spec check date | Status in repo | Limitation carried forward |
|---|---|---|---|---|---|
| S01 | IPL player regulations 2025–27 | `IPL_2025_MEGA_HISTORICAL_v1` purse, retention/RTM caps | 2026-10-09 | Referenced, values not yet encoded (phase 09) | Do not equate salary cap with auction purse |
| S02 | Rajasthan Royals 2025 auction rules | Squad 18–25, 8 overseas, base price range | 2026-10-09 | Referenced (phase 09) | Franchise explainer, not the regulation itself |
| S03 | Rajasthan Royals retention rules | Capped 18/14/11/18/14 cr, uncapped 4 cr floors | 2026-10-09 | Referenced (phase 09) | Not a full contract circular; custom aggregation labeled simulator |
| S04 | Rajasthan Royals RTM explanation | Final-raise / match / decline flow | 2026-10-09 | Referenced (phase 10) | Timers and digital ordering are simulator policies |
| S05 | IPL terms and conditions | Asset rights boundary | 2026-10-09 | Enforced by ADR-017 (no official photos without licence) | No implied licence |
| S06 | IPL image-use terms | Asset clearance checkpoint | 2026-10-09 | Enforced by ADR-017 | PDF not fetched; commercial reuse unverified |
| S07 | Cricsheet licensing | Factual data pack licence per format | 2026-10-09 | Implemented (phase 06): JSON archive, ODC-By 1.0 attribution stored per data version and shown in card detail (ADR-018) | Download blocked in the build environment; run `pnpm data:fetch` where cricsheet.org is reachable |
| S08 | Render WebSockets | Reconnect/instance routing design | 2026-10-09 | Design input (phases 05, 12, 18) | Deploys disconnect sockets |
| S09 | Render free limits | Hosting plan choice | 2026-10-09 | Design input (phase 18) | Free tier unsuitable for reliability |
| S10 | Socket.IO delivery guarantees | Outbox/replay design | 2026-10-09 | Design input (phase 05) | At-most-once default delivery |
| S11 | Socket.IO multiple nodes | Redis adapter deferral (ADR-014) | 2026-10-09 | Deferred | — |
| S12 | Supabase PG connections | Pool sizing (ADR-013) | 2026-10-09 | Design input (phase 02) | — |
| S13 | Supabase RLS | FORCE RLS + browser denial | 2026-10-09 | Implemented from phase 02 | Service key bypasses RLS |
| S14 | Supabase MFA | Admin AAL2 | 2026-10-09 | Phase 03 (local adapter emulates TOTP; ADR-016) | Provider MFA verified only in staging |
| S15 | Supabase pricing | Cost model | 2026-10-09 | Docs only | Recheck before purchase |
| S16 | Vercel pricing/Hobby | Cost model | 2026-10-09 | Docs only | Hobby is noncommercial |
| S17 | Render compute plans | Cost model | 2026-10-09 | Docs only | Pricing page partially unreadable |
| S18 | Vercel WebSocket beta | Correction of blanket limitation | 2026-10-09 | Docs only | Beta; not used for game sockets |
| S19 | PostgreSQL explicit locking | Lock order, deadlock retry | 2026-10-09 | Implemented from phase 05 | — |
| S20 | Supabase SSR client | BFF cookie session | 2026-10-09 | Phase 03 | Deliberate BFF adaptation |
| S21 | IPL 2025 retained players | Fixed historical retention submode | 2026-10-09 | Not encoded (rights/data review gate) | Requires verified import |
| S22 | IPL playing conditions | 4-overseas-XI verification | 2026-10-09 | Gate open: XI overseas cap exposed as simulator rule | Full season text not exposed |
| S23 | OWASP password storage | Argon2id + pepper | 2026-10-09 | Phase 03 | Tune parameters at deploy |
| S24 | Node release schedule | Runtime baseline | 2026-10-09 | Node 22 LTS in dev (ADR-016) | Re-verify Node 24 LTS at deploy |
| S25 | Cricsheet register/matches | Identity mapping for factual pack | 2026-10-09 | Implemented (phase 06): register IDs as identity, `key_cricinfo` aliases for photo lookup | Register lacks country/styles (rendered "Not available") |
| S26 | Official 2025 auction list with RTM | Eligibility/base prices | 2026-10-09 | Not encoded (rights/revision check) | Verify revision before redistribution |

**Release gate:** the historical preset may not be labeled verified until S01–S04, S21, S22 and S26 values are imported through the reviewed data pipeline (phase 06) with checksums and reviewer recorded. Until then only `CASUAL_v1` and the demo pool are published.

## Added in phase 06

| ID | Source | Used by | Status | Limitation |
|---|---|---|---|---|
| S27 | Wikidata (CC0) — ESPNcricinfo ID P2697, image P18, English labels | `pnpm data:photos` player matching and full names | Implemented, not yet run (host blocked in build env) | Coverage depends on Wikidata completeness |
| S28 | Wikimedia Commons file licences (per file: CC0/PD/CC BY/CC BY-SA only) | Real player photos, credited per card (ADR-018) | Implemented, not yet run (host blocked in build env) | Not every player has a free photo in IPL kit; admins upload the rest with recorded rights |
