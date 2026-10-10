import type pg from 'pg';
import type { CatalogImportRequest } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { one } from '../../db/rows';
import { withTransaction } from '../../db/transaction';
import {
  generatedPortraitSvg,
  renderGeneratedPortrait,
  type ProcessedImage,
} from '../media/pipeline';
import { approvedPortrait, registerPortrait } from '../media/service';
import type { MediaStorage } from '../media/storage';
import { importDataVersion, type ImportResult } from './import';
import { cricsheetBundle, demoBundle } from './sources';

export interface CatalogDeps {
  pool: pg.Pool;
  storage: MediaStorage;
  cricsheetDir: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 3);

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/**
 * Original illustrated portraits for fictional demo players only (ADR-017
 * route B). Real players never receive generated faces; they need a real
 * photo (free licence or licensed upload).
 */
async function ensureDemoPortraits(
  deps: CatalogDeps,
  result: ImportResult,
  kits: ReadonlyMap<string, readonly [string, string]>,
  names: ReadonlyMap<string, { name: string }>,
) {
  const todo: { registryId: string; playerId: string }[] = [];
  for (const [registryId, playerId] of result.playerIds) {
    const existing = await approvedPortrait(
      { query: (t, v) => deps.pool.query(t, v as unknown[]) },
      playerId,
    );
    if (!existing) todo.push({ registryId, playerId });
  }
  const rendered = await mapLimit(todo, 4, async (p) => ({
    ...p,
    image: await renderGeneratedPortrait(
      generatedPortraitSvg(
        p.registryId,
        kits.get(p.registryId) ?? ['#24364D', '#9FB3C8'],
        initials(names.get(p.registryId)?.name ?? ''),
      ),
    ),
  }));
  await withTransaction(deps.pool, async (tx) => {
    for (const r of rendered as { registryId: string; playerId: string; image: ProcessedImage }[]) {
      await registerPortrait(tx, deps.storage, r.playerId, r.image, {
        basis: 'original-generated',
        status: 'approved',
        altText: `Original illustrated portrait of ${names.get(r.registryId)?.name ?? 'a fictional player'} (demo)`,
      });
    }
  });
  return rendered.length;
}

/**
 * Start an import as a tracked background job (admin polls its status). The
 * catalog_imports row survives restarts; an interrupted job is reported failed.
 */
export async function startImport(
  deps: CatalogDeps,
  request: CatalogImportRequest,
  actorId: string | null,
): Promise<{ importId: string; done: Promise<void> }> {
  const row = one(
    await deps.pool.query<{ id: string }>(
      `INSERT INTO app_private.catalog_imports (kind, status, created_by, summary)
       VALUES ($1, 'running', $2, $3) RETURNING id`,
      [request.kind, actorId, JSON.stringify({ label: request.label })],
    ),
  );
  const finish = async (
    status: 'succeeded' | 'failed',
    summary: Record<string, unknown>,
    versionId?: string,
  ) => {
    await deps.pool.query(
      `UPDATE app_private.catalog_imports SET status = $2, summary = summary || $3::jsonb, data_version_id = $4,
              finished_at = now() WHERE id = $1`,
      [row.id, status, JSON.stringify(summary), versionId ?? null],
    );
  };
  const done = (async () => {
    try {
      if (request.kind === 'demo') {
        const bundle = demoBundle({ label: request.label });
        const result = await importDataVersion(deps.pool, bundle);
        const generated = await ensureDemoPortraits(deps, result, bundle.kits, bundle.people);
        await finish(
          'succeeded',
          { players: result.players, cards: result.cards, generatedPortraits: generated },
          result.dataVersionId,
        );
      } else {
        const bundle = await cricsheetBundle(deps.cricsheetDir, {
          label: request.label,
          ...(request.latestSeason ? { latestSeason: request.latestSeason } : {}),
        });
        const result = await importDataVersion(deps.pool, bundle);
        await finish(
          'succeeded',
          {
            players: result.players,
            cards: result.cards,
            withPortrait: result.withPortrait,
            window: bundle.windowLabel,
            matches: bundle.aggregate.matches,
          },
          result.dataVersionId,
        );
      }
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : 'The import failed. Check the server logs.';
      await finish('failed', { error: message }).catch(() => undefined);
    }
  })();
  return { importId: row.id, done };
}

export async function importStatus(pool: pg.Pool, importId: string) {
  const res = await pool.query<{
    id: string;
    kind: string;
    status: string;
    data_version_id: string | null;
    summary: Record<string, unknown>;
    created_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT id, kind, status, data_version_id, summary, created_at, finished_at
       FROM app_private.catalog_imports WHERE id = $1`,
    [importId],
  );
  const r = res.rows[0];
  if (!r) throw new AppError('NOT_FOUND', 'Import not found.');
  return {
    importId: r.id,
    kind: r.kind,
    status: r.status,
    dataVersionId: r.data_version_id,
    summary: r.summary,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

/** On startup: jobs left running by a previous process are marked failed. */
export async function failInterruptedImports(pool: pg.Pool) {
  await pool.query(
    `UPDATE app_private.catalog_imports SET status = 'failed', finished_at = now(),
            summary = summary || '{"error":"Interrupted by a server restart."}'::jsonb
      WHERE status = 'running'`,
  );
}
