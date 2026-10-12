import { createHash } from 'node:crypto';
import {
  ENGINE_VERSIONS,
  IPL_MEGA_RULES_2025_27,
  LAKH,
  auctionSet,
  canonicalRules,
  poolOrder,
  rulesFromJson,
  rulesToJson,
  type AuctionRules,
  type CappedStatus,
  type PoolRole,
} from '@stumps/game-engines';
import { one } from '../../db/rows';
import type { Tx } from '../../db/transaction';

type Queryable = Tx;
import { currentVersion } from '../cricket-data/read';

/**
 * Auction rulesets (ADR-024): the real IPL rules plus a frozen pool for one
 * published data version. Published rulesets and their pool entries are
 * immutable (migration 020 triggers); corrections publish a new version.
 */

export interface PoolEntryInput {
  playerId: string;
  name: string;
  role: PoolRole;
  previousFranchiseId: string | null;
  basePrice: bigint;
  cappedStatus: CappedStatus;
  overseas: boolean;
  currentSalary: bigint | null;
  priceSource: 'registered' | 'not_registered' | 'demo';
  sourceId: string;
}

export interface RulesetRow {
  id: string;
  name: string;
  version: number;
  rules: AuctionRules;
  rulesHash: string;
  dataVersionId: string;
  dataKind: 'demo' | 'factual';
  sourceManifest: unknown;
}

/** Insert a draft ruleset with its pool in auction order; returns its ID. */
export async function insertRuleset(
  tx: Tx,
  input: {
    rules: AuctionRules;
    dataVersionId: string;
    sourceManifest: unknown;
    entries: readonly PoolEntryInput[];
  },
): Promise<string> {
  const ordered = poolOrder(input.entries);
  // The hash covers the rules, the data version and the pool, so a new pool is a new ruleset.
  const hash = createHash('sha256')
    .update(canonicalRules(input.rules))
    .update(input.dataVersionId)
    .update(
      ordered
        .map((e) =>
          [e.playerId, e.basePrice, e.cappedStatus, e.previousFranchiseId ?? '', e.overseas].join(
            ':',
          ),
        )
        .join('|'),
    )
    .digest('hex');
  const id = (
    await tx.query<{ id: string }>(
      `INSERT INTO app_private.auction_rulesets
         (name, season_id, data_version_id, version, rules, source_manifest, rules_hash, evaluator_version)
       SELECT $1, v.season_id, v.id,
              coalesce((SELECT max(version) FROM app_private.auction_rulesets WHERE name = $1), 0) + 1,
              $3, $4, $5, $6
         FROM app_private.data_versions v WHERE v.id = $2
       RETURNING id`,
      [
        input.rules.name,
        input.dataVersionId,
        JSON.stringify(rulesToJson(input.rules)),
        JSON.stringify(input.sourceManifest),
        hash,
        ENGINE_VERSIONS.auction,
      ],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('Data version not found for the ruleset.');
  if (ordered.length > 0) {
    await tx.query(
      `INSERT INTO app_private.auction_pool_entries
         (ruleset_id, player_id, previous_franchise_id, base_price, capped_status, set_label,
          set_order, source_id, overseas, role, current_salary, price_source)
       SELECT $1, t.player_id, t.prev, t.base, t.capped, t.set_label, t.ord, t.source, t.overseas,
              t.role, t.salary, t.price_source
         FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::text[], $6::text[], $7::int[],
                     $8::uuid[], $9::boolean[], $10::text[], $11::bigint[], $12::text[])
           AS t(player_id, prev, base, capped, set_label, ord, source, overseas, role, salary, price_source)`,
      [
        id,
        ordered.map((e) => e.playerId),
        ordered.map((e) => e.previousFranchiseId),
        ordered.map((e) => e.basePrice.toString()),
        ordered.map((e) => e.cappedStatus),
        ordered.map((e) => auctionSet(e.role, e.cappedStatus).label),
        ordered.map((_, i) => i),
        ordered.map((e) => e.sourceId),
        ordered.map((e) => e.overseas),
        ordered.map((e) => e.role),
        ordered.map((e) => e.currentSalary?.toString() ?? null),
        ordered.map((e) => e.priceSource),
      ],
    );
  }
  return id;
}

/** Publish a draft ruleset; earlier published rulesets of that name and data version are archived. */
export async function publishRuleset(tx: Tx, rulesetId: string): Promise<void> {
  const res = await tx.query<{ name: string; data_version_id: string }>(
    `UPDATE app_private.auction_rulesets SET status = 'published', published_at = now()
      WHERE id = $1 AND status = 'draft' RETURNING name, data_version_id`,
    [rulesetId],
  );
  const row = res.rows[0];
  if (!row) throw new Error('Only a draft ruleset can be published.');
  await tx.query(
    `UPDATE app_private.auction_rulesets SET status = 'archived'
      WHERE name = $1 AND data_version_id = $2 AND status = 'published' AND id <> $3`,
    [row.name, row.data_version_id, rulesetId],
  );
}

const rowOf = (r: {
  id: string;
  name: string;
  version: number;
  rules: Record<string, unknown>;
  rules_hash: string;
  data_version_id: string;
  kind: 'demo' | 'factual';
  source_manifest: unknown;
}): RulesetRow => ({
  id: r.id,
  name: r.name,
  version: r.version,
  rules: rulesFromJson(r.rules),
  rulesHash: r.rules_hash,
  dataVersionId: r.data_version_id,
  dataKind: r.kind,
  sourceManifest: r.source_manifest,
});

const RULESET_SELECT = `SELECT r.id, r.name, r.version, r.rules, r.rules_hash, r.data_version_id, v.kind, r.source_manifest
   FROM app_private.auction_rulesets r
   JOIN app_private.data_versions v ON v.id = r.data_version_id`;

/** The published ruleset for the current published data pack (factual preferred). */
export async function currentRuleset(db: Queryable): Promise<RulesetRow | null> {
  const version = await currentVersion(db);
  if (!version) return null;
  const res = await db.query<Parameters<typeof rowOf>[0]>(
    `${RULESET_SELECT} WHERE r.data_version_id = $1 AND r.status = 'published'
      ORDER BY r.version DESC LIMIT 1`,
    [version.id],
  );
  return res.rows[0] ? rowOf(res.rows[0]) : null;
}

export async function rulesetById(db: Queryable, id: string): Promise<RulesetRow | null> {
  const res = await db.query<Parameters<typeof rowOf>[0]>(`${RULESET_SELECT} WHERE r.id = $1`, [
    id,
  ]);
  return res.rows[0] ? rowOf(res.rows[0]) : null;
}

/** Demo base-price bands by the player's best card skill (labelled DEMO, never real). */
function demoBasePrice(best: number): bigint {
  const lakhs =
    best >= 850
      ? 200
      : best >= 750
        ? 150
        : best >= 650
          ? 100
          : best >= 550
            ? 75
            : best >= 450
              ? 50
              : 30;
  return BigInt(lakhs) * LAKH;
}

/**
 * The demo pack's ruleset: the same real IPL rules over the fictional league,
 * with DEMO base prices and capped status by card strength. Created when a demo
 * pack is published so offline development and tests have an auction pool.
 */
export async function createDemoRuleset(tx: Tx, dataVersionId: string): Promise<string> {
  const players = await tx.query<{
    player_id: string;
    name: string;
    role: PoolRole | null;
    primary_role: PoolRole;
    franchise_id: string | null;
    overseas: boolean | null;
    best: number;
  }>(
    `SELECT ps.player_id, p.canonical_name AS name, ps.role, p.primary_role, ps.franchise_id, ps.overseas,
            coalesce(max(greatest((d.ratings->>'batting')::int, (d.ratings->>'bowling')::int)), 0) AS best
       FROM app_private.player_seasons ps
       JOIN app_private.players p ON p.id = ps.player_id
       LEFT JOIN app_private.card_players cp ON cp.player_id = ps.player_id
       LEFT JOIN app_private.card_definitions d ON d.id = cp.card_id AND d.data_version_id = ps.data_version_id
      WHERE ps.data_version_id = $1
      GROUP BY ps.player_id, p.canonical_name, ps.role, p.primary_role, ps.franchise_id, ps.overseas`,
    [dataVersionId],
  );
  const source = one(
    await tx.query<{ id: string }>(
      `INSERT INTO app_private.data_sources (publisher, url, fetched_at, licence_label, attribution,
         verification_status, scope)
       VALUES ('STUMPS demo generator', 'stumps:demo-auction-pool', now(), 'Original', '', 'reviewed',
               'DEMO base prices and capped status for the fictional demo league')
       RETURNING id`,
    ),
  ).id;
  const rules: AuctionRules = {
    ...IPL_MEGA_RULES_2025_27,
    label: 'IPL mega auction rules (2025–27) · demo pack',
  };
  return insertRuleset(tx, {
    rules,
    dataVersionId,
    sourceManifest: [{ title: 'DEMO pool (fictional players)', url: 'stumps:demo-auction-pool' }],
    entries: players.rows.map((p) => ({
      playerId: p.player_id,
      name: p.name,
      role: p.role ?? p.primary_role,
      previousFranchiseId: p.franchise_id,
      basePrice: demoBasePrice(p.best),
      cappedStatus: p.best >= 450 ? 'capped' : 'uncapped',
      overseas: p.overseas ?? false,
      currentSalary: null,
      priceSource: 'demo',
      sourceId: source,
    })),
  });
}
