# ADR-003: Realtime transport: Socket.IO with PostgreSQL outbox

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR03); DB/realtime §1–§4.

## Context and alternatives
Socket.IO (acks, reconnect, rooms) vs raw ws vs Supabase Realtime.

## Risks
None provides game authority; Socket.IO default delivery is at-most-once.

## Decision
Socket.IO commands/events on the Render HTTP server, WebSocket-only transport. Durability from PG transactional outbox (`room_events`), snapshots and replay. Clients dedupe by stream seq.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
