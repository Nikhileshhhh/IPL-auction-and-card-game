import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AdminMediaUploadSchema,
  CatalogImportRequestSchema,
  MediaReviewSchema,
  PlayerCorrectionSchema,
  PublishRequestSchema,
  RaritySchema,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { withTransaction } from '../../db/transaction';
import { authenticateMember } from '../../modules/auth/service';
import { requireAdmin } from '../../modules/admin/service';
import { requireMembership } from '../../rooms/projection';
import {
  cardDetail,
  currentVersion,
  listAdminPlayers,
  listCards,
  listVersions,
  showcase,
} from '../../modules/cricket-data/read';
import { archiveVersion, discardDraft, publishVersion } from '../../modules/cricket-data/publish';
import { importStatus, startImport } from '../../modules/cricket-data/service';
import {
  applyManifest,
  manifestTemplate,
  parseManifest,
} from '../../modules/cricket-data/manifest';
import { uploadPortrait, reviewPortrait } from '../../modules/media/admin';
import { MAX_UPLOAD_BYTES, VARIANT_WIDTHS, type VariantWidth } from '../../modules/media/pipeline';
import { portraitPath, readPortrait } from '../../modules/media/service';
import type { RuntimeDeps } from '../../runtime';

const Id = z.object({ id: z.uuid() });
const MediaParams = z.object({ assetId: z.uuid(), width: z.coerce.number().int() });
const ListQuery = z.object({
  cursor: z.string().max(200).optional(),
  rarity: RaritySchema.optional(),
});

function idOf(request: FastifyRequest): string {
  const parsed = Id.safeParse(request.params);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'Not found.');
  return parsed.data.id;
}

function mediaParams(request: FastifyRequest): { assetId: string; width: VariantWidth } {
  const parsed = MediaParams.safeParse(request.params);
  if (!parsed.success || !(VARIANT_WIDTHS as readonly number[]).includes(parsed.data.width)) {
    throw new AppError('NOT_FOUND', 'Image not found.');
  }
  return { assetId: parsed.data.assetId, width: parsed.data.width as VariantWidth };
}

export async function catalogRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  const member = (request: FastifyRequest) => authenticateMember(deps, requireIngress(request));
  const admin = (request: FastifyRequest) =>
    requireAdmin(deps, requireIngress(request), { aal2: true });
  const catalogDeps = {
    pool: deps.pool,
    storage: deps.media,
    cricsheetDir: deps.env.CRICSHEET_DIR,
  };

  async function requireCurrent() {
    const version = await currentVersion(deps.pool);
    if (!version) {
      throw new AppError('NOT_FOUND', 'No card catalog has been published yet.', {
        reason: 'NO_CATALOG',
      });
    }
    return version;
  }

  // ------------------------------------------------------------- members

  app.get('/catalog/showcase', async (request) => {
    await member(request);
    const version = await requireCurrent();
    return success(
      {
        dataVersionId: version.id,
        dataLabel: version.label,
        items: await showcase(deps.pool, version.id),
      },
      request.id,
      new Date(),
    );
  });

  app.get('/catalog/cards', async (request) => {
    await member(request);
    const query = ListQuery.safeParse(request.query);
    if (!query.success) throw new AppError('VALIDATION_FAILED', 'Request is malformed.');
    const version = await requireCurrent();
    const page = await listCards(deps.pool, {
      versionId: version.id,
      cursor: query.data.cursor ?? null,
      rarity: query.data.rarity ?? null,
    });
    return success(
      { dataVersionId: version.id, dataLabel: version.label, ...page },
      request.id,
      new Date(),
    );
  });

  app.get('/catalog/cards/:id', async (request) => {
    await member(request);
    return success(await cardDetail(deps.pool, idOf(request)), request.id, new Date());
  });

  /** M: the card pool a room will play with (latest published version until start freezes it). */
  app.get('/rooms/:id/catalog', async (request) => {
    const ctx = await member(request);
    const roomId = idOf(request);
    await withTransaction(deps.pool, (tx) => requireMembership(tx, roomId, ctx.userId), {
      readOnly: true,
    });
    const query = ListQuery.safeParse(request.query);
    if (!query.success) throw new AppError('VALIDATION_FAILED', 'Request is malformed.');
    const version = await requireCurrent();
    const page = await listCards(deps.pool, {
      versionId: version.id,
      cursor: query.data.cursor ?? null,
      rarity: query.data.rarity ?? null,
    });
    return success(
      { dataVersionId: version.id, dataLabel: version.label, ...page },
      request.id,
      new Date(),
    );
  });

  app.get('/media/:assetId/read-url', async (request) => {
    await member(request);
    const parsed = z.object({ assetId: z.uuid() }).safeParse(request.params);
    if (!parsed.success) throw new AppError('NOT_FOUND', 'Image not found.');
    const { assetId } = parsed.data;
    // Existence/authorization check without returning bytes.
    await readPortrait(deps.pool, deps.media, assetId, 320);
    return success(
      { url: portraitPath(assetId, 640), expiresAt: new Date(Date.now() + 60_000).toISOString() },
      request.id,
      new Date(),
    );
  });

  /** Bytes for an approved, published portrait (via the BFF, session-cookie authorized). */
  app.get('/media/:assetId/:width', async (request, reply) => {
    await member(request);
    const { assetId, width } = mediaParams(request);
    const bytes = await readPortrait(deps.pool, deps.media, assetId, width);
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=600')
      .header('Content-Disposition', 'inline')
      .send(bytes);
  });

  // ------------------------------------------------------------- admin

  app.get('/admin/catalog/versions', async (request) => {
    await admin(request);
    return success({ items: await listVersions(deps.pool) }, request.id, new Date());
  });

  app.post('/admin/catalog/imports', async (request, reply) => {
    const ctx = await admin(request);
    const body = parseBody(CatalogImportRequestSchema, request.body);
    const { importId } = await startImport(catalogDeps, body, ctx.userId);
    return reply.code(202).send(success({ importId }, request.id, new Date()));
  });

  app.get('/admin/catalog/imports/:id', async (request) => {
    await admin(request);
    return success(await importStatus(deps.pool, idOf(request)), request.id, new Date());
  });

  app.get('/admin/catalog/versions/:id/players', async (request) => {
    await admin(request);
    const q = z
      .object({
        q: z.string().max(80).optional(),
        incomplete: z.enum(['true', 'false']).optional(),
        offset: z.coerce.number().int().min(0).max(100_000).optional(),
      })
      .safeParse(request.query);
    if (!q.success) throw new AppError('VALIDATION_FAILED', 'Request is malformed.');
    return success(
      await listAdminPlayers(deps.pool, idOf(request), {
        ...(q.data.q ? { query: q.data.q } : {}),
        incomplete: q.data.incomplete === 'true',
        offset: q.data.offset ?? 0,
      }),
      request.id,
      new Date(),
    );
  });

  /** Pre-filled player sheet (facts + licensed IPL-jersey photo columns) for a version. */
  app.get('/admin/catalog/versions/:id/player-sheet', async (request) => {
    await admin(request);
    return success(
      { csv: await manifestTemplate(deps.pool, idOf(request)) },
      request.id,
      new Date(),
    );
  });

  /** Apply a filled player sheet. Photos here must be https URLs on PHOTO_IMPORT_HOSTS. */
  app.post('/admin/catalog/player-sheet', { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const ctx = await admin(request);
    const body = parseBody(
      z.object({ csv: z.string().min(1).max(2_500_000) }).strict(),
      request.body,
    );
    const parsed = parseManifest(body.csv);
    const report = await applyManifest(deps.pool, deps.media, parsed.rows, {
      allowedHosts: deps.env.PHOTO_IMPORT_HOSTS,
      actorId: ctx.userId,
    });
    return success(
      { ...report, issues: [...parsed.issues, ...report.issues].sort((a, b) => a.line - b.line) },
      request.id,
      new Date(),
    );
  });

  app.get('/admin/catalog/versions/:id/cards', async (request) => {
    await admin(request);
    const query = ListQuery.safeParse(request.query);
    if (!query.success) throw new AppError('VALIDATION_FAILED', 'Request is malformed.');
    return success(
      await listCards(deps.pool, {
        versionId: idOf(request),
        cursor: query.data.cursor ?? null,
        rarity: query.data.rarity ?? null,
        includeDrafts: true,
      }),
      request.id,
      new Date(),
    );
  });

  app.get('/admin/catalog/cards/:id', async (request) => {
    await admin(request);
    return success(
      await cardDetail(deps.pool, idOf(request), { includeDrafts: true }),
      request.id,
      new Date(),
    );
  });

  /** Reviewed corrections (role, names, country, styles); roles apply when a draft is rebuilt. */
  app.patch('/admin/catalog/players/:id', async (request) => {
    const ctx = await admin(request);
    const playerId = idOf(request);
    const body = parseBody(PlayerCorrectionSchema, request.body);
    const res = await deps.pool.query(
      `UPDATE app_private.players SET
          canonical_name = coalesce($2, canonical_name),
          primary_role = coalesce($3, primary_role),
          role_reviewed = role_reviewed OR $3 IS NOT NULL,
          country_code = CASE WHEN $4::boolean THEN $5 ELSE country_code END,
          batting_style = CASE WHEN $6::boolean THEN $7 ELSE batting_style END,
          bowling_style = CASE WHEN $8::boolean THEN $9 ELSE bowling_style END,
          updated_at = now()
        WHERE id = $1`,
      [
        playerId,
        body.canonicalName ?? null,
        body.role ?? null,
        body.countryCode !== undefined,
        body.countryCode ?? null,
        body.battingStyle !== undefined,
        body.battingStyle ?? null,
        body.bowlingStyle !== undefined,
        body.bowlingStyle ?? null,
      ],
    );
    if (res.rowCount !== 1) throw new AppError('NOT_FOUND', 'Player not found.');
    await deps.pool.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'catalog.player_corrected', 'player', $2)`,
      [ctx.userId, JSON.stringify({ playerId, fields: Object.keys(body) })],
    );
    return success({ updated: true, roleAppliesOn: 'next draft rebuild' }, request.id, new Date());
  });

  app.post('/admin/catalog/:id/publish', async (request) => {
    const ctx = await admin(request);
    const body = parseBody(PublishRequestSchema, request.body ?? {});
    const result = await publishVersion(deps.pool, idOf(request), {
      prune: body.prune,
      actorId: ctx.userId,
    });
    return success(result, request.id, new Date());
  });

  app.post('/admin/catalog/versions/:id/archive', async (request) => {
    const ctx = await admin(request);
    return success(
      await archiveVersion(deps.pool, idOf(request), ctx.userId),
      request.id,
      new Date(),
    );
  });

  app.post('/admin/catalog/versions/:id/discard', async (request) => {
    await admin(request);
    return success(await discardDraft(deps.pool, idOf(request)), request.id, new Date());
  });

  app.post(
    '/admin/catalog/media',
    { bodyLimit: Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4096 },
    async (request) => {
      const ctx = await admin(request);
      const body = parseBody(AdminMediaUploadSchema, request.body);
      return success(
        await uploadPortrait(deps.pool, deps.media, body, ctx.userId),
        request.id,
        new Date(),
      );
    },
  );

  app.post('/admin/catalog/media/:id/review', async (request) => {
    const ctx = await admin(request);
    const body = parseBody(MediaReviewSchema, request.body);
    return success(
      await reviewPortrait(deps.pool, idOf(request), body.decision, body.note, ctx.userId),
      request.id,
      new Date(),
    );
  });

  /** Admin preview of any portrait (pending/rejected included). */
  app.get('/admin/catalog/media/:assetId/:width', async (request, reply) => {
    await admin(request);
    const { assetId, width } = mediaParams(request);
    const bytes = await readPortrait(deps.pool, deps.media, assetId, width, { admin: true });
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, no-store')
      .send(bytes);
  });
}
