# STUMPS — private cricket card battle and mega-auction platform

STUMPS is a proposed working name for a private, invitation-only multiplayer platform with two games:

- **Card Battle** — a 2–8 player cricket card comparison game with server-authoritative dealing, ties and pots.
- **Mega Auction** — a franchise auction simulator with collaborative teams, RTM, timers and squad evaluation.

## Specification (v1.0)

The normative product specification lives in [`docs/spec/`](docs/spec/):

| Document | Purpose |
|---|---|
| [Master plan](docs/spec/CRICKET_MULTIPLAYER_PLATFORM_MASTER_PLAN.md) | Product authority, scope, evidence register, architecture decisions |
| [Game rules and state machines](docs/spec/GAME_RULES_AND_STATE_MACHINES.md) | Normative card and auction rules |
| [Database and realtime architecture](docs/spec/DATABASE_AND_REALTIME_ARCHITECTURE.md) | Schema, RLS, command/event contracts |
| [UI/UX design system](docs/spec/UI_UX_DESIGN_SYSTEM.md) | Tokens, components and all 35 screens |
| [Implementation prompts](docs/spec/CODEX_IMPLEMENTATION_PROMPTS.md) | Phase-by-phase build roadmap (phases 00–19) |

## Development

Requirements: Node 22+, pnpm 10, PostgreSQL 16 binaries (no Docker needed).

```bash
pnpm install
scripts/db/local-pg.sh start   # local PostgreSQL on 127.0.0.1:54329
pnpm db:reset                  # create database 'stumps' from migrations
cp .env.example .env           # adjust as needed
pnpm dev                       # web on :3000, API on :4000
```

Quality gates: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`. See [AGENTS.md](AGENTS.md) for conventions and `docs/phase-reports/` for per-phase evidence.

STUMPS is not affiliated with the IPL, BCCI or any franchise. Historical rulesets are labeled as simulations.
