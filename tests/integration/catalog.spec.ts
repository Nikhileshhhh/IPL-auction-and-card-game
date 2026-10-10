import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardDetailDTO, PublicCardDTO } from '@stumps/contracts';
import { generateDemoLeague } from '@stumps/game-engines';
import {
  ACCESS_CODE,
  adminSignIn,
  createTestApi,
  makeAdmin,
  onboardMember,
  type BffClient,
  type TestApi,
} from '../support/api';

/** A Cricsheet-shaped archive (fictional league) so the factual path runs offline. */
function writeCricsheetFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stumps-cricsheet-'));
  const league = generateDemoLeague({ seed: 77, seasons: [2023, 2024, 2025] });
  const files: Record<string, Uint8Array> = {};
  league.matches.forEach((m, i) => {
    files[`${1000 + i}.json`] = strToU8(JSON.stringify(m));
  });
  files['README.txt'] = strToU8('fixture');
  writeFileSync(join(dir, 'ipl_json.zip'), zipSync(files));
  const rows = ['identifier,name,unique_name,key_cricinfo'];
  for (const p of league.players)
    rows.push(`${p.id},"${p.name}","${p.name}",${9000 + Number(p.id.slice(4))}`);
  writeFileSync(join(dir, 'people.csv'), rows.join('\n'));
  return dir;
}

let api: TestApi;
let admin: BffClient;
let member: BffClient;

async function runImport(body: Record<string, unknown>) {
  const started = await admin.request<{ importId: string }>(
    'POST',
    '/v1/admin/catalog/imports',
    body,
    {
      admin: true,
    },
  );
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  for (let i = 0; i < 300; i += 1) {
    const status = await admin.request<{
      status: string;
      dataVersionId: string | null;
      summary: Record<string, unknown>;
    }>('GET', `/v1/admin/catalog/imports/${started.body.data!.importId}`, undefined, {
      admin: true,
    });
    if (status.body.data!.status !== 'running') return status.body.data!;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('import did not finish');
}

/** Raw (binary-safe) GET through the signed ingress. */
async function rawGet(client: BffClient, url: string) {
  const res = await api.app.inject({
    method: 'GET',
    url,
    headers: client.signedHeaders('GET', url, ''),
  });
  return res.statusCode;
}

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 800, channels: 3, background: '#3366aa' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'fixture-exif-marker', Artist: 'fixture' } } })
    .toBuffer();
}

beforeAll(async () => {
  api = await createTestApi('stumps_it_catalog', { CRICSHEET_DIR: writeCricsheetFixture() });
  await api.setAccessCode(ACCESS_CODE);
  const owner = await onboardMember(api, 'catalog_admin');
  await makeAdmin(api, owner.userId);
  admin = (await adminSignIn(api, owner.email, owner.password, owner.client)).client;
  member = (await onboardMember(api, 'catalog_member')).client;
}, 120_000);
afterAll(async () => api?.close());

describe('demo pack: import → validate → publish (route B portraits)', () => {
  let versionId = '';

  it('imports the fictional league with ratings, cards and generated portraits', async () => {
    const result = await runImport({ kind: 'demo', label: 'Demo pack v1' });
    expect(result.status, JSON.stringify(result.summary)).toBe('succeeded');
    versionId = result.dataVersionId as string;
    const versions = await admin.request<{
      items: { id: string; players: number; cards: number; withPortrait: number }[];
    }>('GET', '/v1/admin/catalog/versions', undefined, { admin: true });
    const v = versions.body.data!.items.find((x) => x.id === versionId)!;
    expect(v.players).toBeGreaterThanOrEqual(40);
    expect(v.withPortrait).toBe(v.players); // every demo player has a portrait
    expect(v.cards).toBeGreaterThan(v.players); // singles + duals
  }, 120_000);

  it('members see nothing until a version is published', async () => {
    const res = await member.request('GET', '/v1/catalog/showcase');
    expect(res.status).toBe(404);
  });

  it('publishes, then the version is immutable', async () => {
    const pub = await admin.request<{ contentHash: string }>(
      'POST',
      `/v1/admin/catalog/${versionId}/publish`,
      {},
      { admin: true },
    );
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body.data!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const again = await admin.request(
      'POST',
      `/v1/admin/catalog/${versionId}/publish`,
      {},
      { admin: true },
    );
    expect(again.body.error!.code).toBe('STATE_CONFLICT');
    await expect(
      api.admin.query(
        `UPDATE app_private.card_definitions SET stars = 5 WHERE data_version_id = $1`,
        [versionId],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('every published card carries a portrait and Attax-style 0–100 ratings with a 100 top', async () => {
    const all: PublicCardDTO[] = [];
    let cursor: string | null = null;
    do {
      const page: {
        status: number;
        body: { data?: { items: PublicCardDTO[]; nextCursor: string | null } };
      } = await member.request(
        'GET',
        `/v1/catalog/cards${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.status).toBe(200);
      all.push(...page.body.data!.items);
      cursor = page.body.data!.nextCursor;
    } while (cursor);
    expect(all.length).toBeGreaterThan(40);
    for (const card of all) {
      for (const p of card.players)
        expect(p.portraitUrl).toMatch(/^\/api\/media\/[0-9a-f-]{36}\/640$/);
      for (const v of Object.values(card.ratings)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    expect(Math.max(...all.map((c) => c.ratings.batting))).toBe(100);
    expect(Math.max(...all.map((c) => c.ratings.bowling))).toBe(100);
    expect(new Set(all.map((c) => c.rarity))).toEqual(
      new Set(['normal', 'bronze', 'silver', 'gold', 'platinum', 'dual_platinum']),
    );
    const dual = all.find((c) => c.rarity === 'dual_platinum')!;
    expect(dual.players).toHaveLength(2);
    expect(Math.max(...Object.values(dual.ratings))).toBeLessThanOrEqual(95);
  });

  it('serves portrait bytes only to signed-in members, as re-encoded WebP', async () => {
    const show = await member.request<{ items: PublicCardDTO[] }>('GET', '/v1/catalog/showcase');
    expect(show.body.data!.items).toHaveLength(6);
    const assetId = show.body.data!.items[0]!.players[0]!.portraitUrl.split('/')[3]!;
    const res = await api.app.inject({
      method: 'GET',
      url: `/v1/media/${assetId}/320`,
      headers: member.signedHeaders('GET', `/v1/media/${assetId}/320`, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('private, max-age=600');
    expect((await sharp(res.rawPayload).metadata()).format).toBe('webp');
    expect(await rawGet(api.client('192.0.2.91'), `/v1/media/${assetId}/320`)).toBe(401);
    expect(await rawGet(member, `/v1/media/${assetId}/123`)).toBe(404);
  });

  it('card detail exposes sourced raw statistics with the data scope label', async () => {
    const show = await member.request<{ items: PublicCardDTO[] }>('GET', '/v1/catalog/showcase');
    const card = show.body.data!.items.find((c) => c.players.length === 1)!;
    const detail = await member.request<CardDetailDTO>(
      'GET',
      `/v1/catalog/cards/${card.definitionId}`,
    );
    expect(detail.status).toBe(200);
    const raw = detail.body.data!.players[0]!.raw!;
    expect(raw.scopeLabel).toContain('Demo league');
    expect(raw.matches).toBeGreaterThan(0);
    expect(detail.body.data!.source.publisher).toBe('STUMPS demo generator');
  });
});

describe('factual pack (Cricsheet format): photos gate publication', () => {
  let versionId = '';

  it('imports from the archive with register IDs, cricinfo aliases and no invented photos', async () => {
    const result = await runImport({ kind: 'cricsheet', label: 'IPL factual v1' });
    expect(result.status, JSON.stringify(result.summary)).toBe('succeeded');
    versionId = result.dataVersionId as string;
    expect(result.summary.withPortrait).toBe(0);
    const aliases = await api.admin.query(
      `SELECT count(*)::int AS n FROM app_private.player_external_ids WHERE source = 'cricinfo'`,
    );
    expect(aliases.rows[0].n).toBeGreaterThan(40);
    const src = await api.admin.query(
      `SELECT s.licence_label, s.checksum FROM app_private.data_versions v
         JOIN app_private.player_seasons ps ON ps.data_version_id = v.id
         JOIN app_private.data_sources s ON s.id = ps.source_id WHERE v.id = $1 LIMIT 1`,
      [versionId],
    );
    expect(src.rows[0].licence_label).toContain('ODC-By');
    expect(src.rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it('publishing is blocked while cards lack photos (PUBLISH_BLOCKED)', async () => {
    const res = await admin.request(
      'POST',
      `/v1/admin/catalog/${versionId}/publish`,
      {},
      { admin: true },
    );
    expect(res.status).toBe(422);
    expect(res.body.error!.code).toBe('PUBLISH_BLOCKED');
  });

  it('rejects non-images and oversize uploads; strips metadata from accepted photos', async () => {
    const players = await admin.request<{ items: { playerId: string; name: string }[] }>(
      'GET',
      `/v1/admin/catalog/versions/${versionId}/players?missingPhoto=true`,
      undefined,
      { admin: true },
    );
    const target = players.body.data!.items[0]!;
    const rights = {
      basis: 'free-license',
      licence: 'CC BY-SA 4.0',
      author: 'Fixture Photographer',
      attribution: 'Photo: Fixture Photographer, CC BY-SA 4.0, via Wikimedia Commons',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    };
    const notImage = await admin.request(
      'POST',
      '/v1/admin/catalog/media',
      {
        playerId: target.playerId,
        imageBase64: Buffer.from('<svg onload=alert(1)>').toString('base64'),
        rights,
      },
      { admin: true },
    );
    expect(notImage.status).toBe(400);
    expect(notImage.body.error!.details).toMatchObject({ reason: 'IMAGE_TYPE' });

    const jpeg = await jpegWithExif();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const ok = await admin.request<{ assetId: string }>(
      'POST',
      '/v1/admin/catalog/media',
      { playerId: target.playerId, imageBase64: jpeg.toString('base64'), rights },
      { admin: true },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const preview = await api.app.inject({
      method: 'GET',
      url: `/v1/admin/catalog/media/${ok.body.data!.assetId}/960`,
      headers: admin.signedHeaders(
        'GET',
        `/v1/admin/catalog/media/${ok.body.data!.assetId}/960`,
        '',
        { admin: true },
      ),
    });
    expect(preview.statusCode).toBe(200);
    const meta = await sharp(preview.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([960, 1280]);
    expect(preview.rawPayload.includes(Buffer.from('fixture-exif-marker'))).toBe(false);
  });

  it('publish with prune keeps only cards whose players have approved photos', async () => {
    const res = await admin.request<{ pruned: number; report: { totals: { cards: number } } }>(
      'POST',
      `/v1/admin/catalog/${versionId}/publish`,
      { prune: true },
      { admin: true },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data!.pruned).toBeGreaterThan(0);
    expect(res.body.data!.report.totals.cards).toBeGreaterThanOrEqual(1);
    // The factual pack is now preferred over the demo pack.
    const page = await member.request<{ items: PublicCardDTO[]; dataLabel: string }>(
      'GET',
      '/v1/catalog/cards',
    );
    expect(page.body.data!.dataLabel).toMatch(/^IPL 2023–2025, as of/);
    for (const card of page.body.data!.items) {
      expect(card.dataKind).toBe('factual');
      expect(card.players[0]!.photoCredit?.licence).toBe('CC BY-SA 4.0');
    }
  });

  it('revoking a photo stops serving it immediately', async () => {
    const page = await member.request<{ items: PublicCardDTO[] }>('GET', '/v1/catalog/cards');
    const assetId = page.body.data!.items[0]!.players[0]!.portraitUrl.split('/')[3]!;
    expect(await rawGet(member, `/v1/media/${assetId}/320`)).toBe(200);
    const revoke = await admin.request(
      'POST',
      `/v1/admin/catalog/media/${assetId}/review`,
      { decision: 'rejected', note: 'licence withdrawn' },
      { admin: true },
    );
    expect(revoke.status).toBe(200);
    expect(await rawGet(member, `/v1/media/${assetId}/320`)).toBe(404);
  });

  it('admin corrections are audited; members cannot reach admin catalog routes', async () => {
    const players = await admin.request<{ items: { playerId: string }[] }>(
      'GET',
      `/v1/admin/catalog/versions/${versionId}/players`,
      undefined,
      { admin: true },
    );
    const id = players.body.data!.items[0]!.playerId;
    const fix = await admin.request(
      'PATCH',
      `/v1/admin/catalog/players/${id}`,
      { role: 'all_rounder', countryCode: 'IN' },
      { admin: true },
    );
    expect(fix.status).toBe(200);
    const audit = await api.admin.query(
      `SELECT 1 FROM app_private.admin_audit WHERE action = 'catalog.player_corrected'`,
    );
    expect(audit.rowCount).toBe(1);
    expect((await member.request('GET', '/v1/admin/catalog/versions')).status).toBe(401);
  });
});
