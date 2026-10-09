# Toolchain

Pinned for STUMPS v1.0 development. Exact versions are locked in `pnpm-lock.yaml` (phase 01). Versions were chosen to be stable releases at least two weeks old on 9 October 2026; beta APIs are not used.

| Tool / library | Version | Notes |
|---|---|---|
| Node.js | 22.22.0 (dev); target 24 LTS for production | ADR-016. `engines.node >=22.12` |
| pnpm | 10.28.0 | `packageManager` field pins it |
| TypeScript | 5.9.3 | typescript-eslint 8.x supports TS < 6.1; TS 7 (native) not adopted |
| Next.js | 16.x | App Router; React 19 |
| React / React DOM | 19.x | |
| Tailwind CSS | 4.x | Design tokens as CSS variables (`apps/web/styles/tokens.css`) |
| Radix primitives (shadcn/ui pattern) | latest stable | Accessible dialogs, tabs, tooltips |
| motion | single animation library | No second animation library (phase 01 mistake list) |
| TanStack Query | 5.x | HTTP resources only |
| Zustand | 5.x | Room projection store (UI spec §6) |
| Fastify | 5.x | API server |
| Socket.IO server/client | 4.8.x (same major) | WebSocket-only transport |
| Zod | 4.x | Single validation library, shared contracts |
| pg | 8.x | Parameterized SQL, explicit transactions |
| argon2 | 0.4x | Argon2id + pepper |
| Pino | 10.x | Structured logs with redaction |
| Vitest | latest stable | unit/integration/security/concurrency |
| fast-check | 4.x | Property tests |
| Playwright | 1.56.1 | Matches the preinstalled Chromium build 1194 (`/opt/pw-browsers`) |
| @axe-core/playwright | 4.x | Automated accessibility checks |
| ESLint / typescript-eslint / Prettier | 9–10 / 8.x / 3.x | Flat config |
| PostgreSQL | 16 (local) | Supabase-compatible shim (ADR-016) |
| Icons | lucide-react | License retained |

## Local services
- PostgreSQL: `scripts/db/local-pg.sh start` creates a throwaway cluster under `.local/pg` on port 54329.
- No Docker daemon is required.
