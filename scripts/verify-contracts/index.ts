/**
 * pnpm contracts:check — verifies the machine-readable catalogs in
 * packages/contracts/schema/*.json agree with the TypeScript contracts
 * that the server and web app actually import.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AUCTION_EVENT_PAYLOADS,
  AUCTION_LIVE_EVENT_PAYLOADS,
  TEAM_EVENT_PAYLOADS,
  TeamPermissionsAck,
  TeamPermissionsPayload,
  CaptainProposeAck,
  CaptainProposePayload,
  CaptainAcceptAck,
  CaptainAcceptPayload,
  InviteRotateAck,
  InviteRotatePayload,
  ShortlistUpsertAck,
  ShortlistUpsertPayload,
  ShortlistRemoveAck,
  ShortlistRemovePayload,
  ShortlistVoteAck,
  ShortlistVotePayload,
  TeamViewSchema,
  ShortlistViewSchema,
  AuctionLiveSnapshotSchema,
  BidAck,
  BidPayload,
  NominationSchema,
  PauseAck,
  PausePayload,
  ResumeAck,
  ResumePayload,
  RtmFinalOfferAck,
  RtmFinalOfferPayload,
  RtmIntentAck,
  RtmIntentPayload,
  RtmMatchAck,
  RtmMatchPayload,
  SkipAck,
  SkipPayload,
  AuctionPlayerSchema,
  AuctionSetupSnapshotSchema,
  CARD_EVENT_PAYLOADS,
  ClaimFranchiseAck,
  ClaimFranchisePayload,
  CloseFranchiseSelectionAck,
  CloseFranchiseSelectionPayload,
  DecideJoinAck,
  DecideJoinPayload,
  PublicTeamSchema,
  RequestJoinAck,
  RequestJoinPayload,
  RetentionLockAck,
  RetentionLockPayload,
  RetentionProposeAck,
  RetentionProposePayload,
  SquadDTOSchema,
  COMMAND_TYPES,
  ERROR_CODES,
  EVENT_TYPES,
  PermittedCardSnapshotSchema,
  RevealAcknowledgedAck,
  RevealAcknowledgedPayload,
  SelectCategoryAck,
  SelectCategoryPayload,
} from '../../packages/contracts/src/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaDir = join(root, 'packages', 'contracts', 'schema');
const load = <T>(file: string): T => JSON.parse(readFileSync(join(schemaDir, file), 'utf8')) as T;

type CommandCatalog = {
  commands: Record<
    string,
    { events: string[]; errors: string[]; payload: string[]; ack: string[] }
  >;
};
type DtoCatalog = { dtos: Record<string, string[]> };
type EventCatalog = { events: Record<string, { audience: string; payload: string[] }> };
type ErrorCatalog = { codes: Record<string, { http: number; retryable: boolean }> };
type HttpCatalog = { operations: { method: string; path: string; rights: string }[] };

const problems: string[] = [];
const commands = load<CommandCatalog>('commands.json').commands;
const events = load<EventCatalog>('events.json').events;
const errors = load<ErrorCatalog>('error-codes.json').codes;
const http = load<HttpCatalog>('http-operations.json').operations;

function sameSet(label: string, ts: readonly string[], json: readonly string[]) {
  const a = new Set(ts);
  const b = new Set(json);
  for (const x of a)
    if (!b.has(x)) problems.push(`${label}: '${x}' in TypeScript but not in JSON catalog`);
  for (const x of b)
    if (!a.has(x)) problems.push(`${label}: '${x}' in JSON catalog but not in TypeScript`);
  if (a.size !== ts.length) problems.push(`${label}: duplicate entries in TypeScript list`);
}

sameSet('commands', COMMAND_TYPES, Object.keys(commands));
sameSet('events', EVENT_TYPES, Object.keys(events));
sameSet('errors', Object.keys(ERROR_CODES), Object.keys(errors));

for (const [code, spec] of Object.entries(errors)) {
  const ts = (ERROR_CODES as Record<string, { http: number; retryable: boolean }>)[code];
  if (ts && (ts.http !== spec.http || ts.retryable !== spec.retryable)) {
    problems.push(
      `errors: '${code}' differs (TS ${ts.http}/${ts.retryable} vs JSON ${spec.http}/${spec.retryable})`,
    );
  }
}
for (const [name, cmd] of Object.entries(commands)) {
  for (const e of cmd.events)
    if (!(e in events)) problems.push(`commands: '${name}' emits unknown event '${e}'`);
  for (const c of cmd.errors)
    if (!(c in errors)) problems.push(`commands: '${name}' uses unknown error '${c}'`);
}
// Field lists of implemented schemas must match their catalog entries ("x?" = optional/nullable).
const fields = (names: readonly string[]) => names.map((n) => n.replace(/\?$/, ''));
const shapeOf = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape);
for (const [type, schema] of Object.entries({
  ...CARD_EVENT_PAYLOADS,
  ...AUCTION_EVENT_PAYLOADS,
  ...AUCTION_LIVE_EVENT_PAYLOADS,
  ...TEAM_EVENT_PAYLOADS,
})) {
  sameSet(`event payload ${type}`, shapeOf(schema), fields(events[type]?.payload ?? []));
}
const implementedCommands = {
  'card.selectCategory': [SelectCategoryPayload, SelectCategoryAck],
  'card.revealAcknowledged': [RevealAcknowledgedPayload, RevealAcknowledgedAck],
  'auction.claimFranchise': [ClaimFranchisePayload, ClaimFranchiseAck],
  'team.requestJoin': [RequestJoinPayload, RequestJoinAck],
  'team.decideJoin': [DecideJoinPayload, DecideJoinAck],
  'auction.retention.propose': [RetentionProposePayload, RetentionProposeAck],
  'auction.retention.lock': [RetentionLockPayload, RetentionLockAck],
  'auction.franchiseSelection.close': [CloseFranchiseSelectionPayload, CloseFranchiseSelectionAck],
  'auction.bid': [BidPayload, BidAck],
  'auction.rtm.intent': [RtmIntentPayload, RtmIntentAck],
  'auction.rtm.finalOffer': [RtmFinalOfferPayload, RtmFinalOfferAck],
  'auction.rtm.match': [RtmMatchPayload, RtmMatchAck],
  'auction.pause': [PausePayload, PauseAck],
  'auction.resume': [ResumePayload, ResumeAck],
  'auction.skip': [SkipPayload, SkipAck],
  'team.permissions': [TeamPermissionsPayload, TeamPermissionsAck],
  'team.captain.propose': [CaptainProposePayload, CaptainProposeAck],
  'team.captain.accept': [CaptainAcceptPayload, CaptainAcceptAck],
  'team.invite.rotate': [InviteRotatePayload, InviteRotateAck],
  'team.shortlist.upsert': [ShortlistUpsertPayload, ShortlistUpsertAck],
  'team.shortlist.remove': [ShortlistRemovePayload, ShortlistRemoveAck],
  'team.shortlist.vote': [ShortlistVotePayload, ShortlistVoteAck],
} as const;
for (const [type, [payload, ack]] of Object.entries(implementedCommands)) {
  sameSet(`command payload ${type}`, shapeOf(payload), fields(commands[type]?.payload ?? []));
  sameSet(`command ack ${type}`, shapeOf(ack), fields(commands[type]?.ack ?? []));
}
const dtos = load<DtoCatalog>('dto-catalog.json').dtos;
sameSet(
  'dto PermittedCardSnapshot',
  shapeOf(PermittedCardSnapshotSchema),
  fields(dtos.PermittedCardSnapshot ?? []),
);

for (const [name, schema] of [
  ['AuctionSetupSnapshot', AuctionSetupSnapshotSchema],
  ['PublicTeamDTO', PublicTeamSchema],
  ['AuctionPlayerDTO', AuctionPlayerSchema],
  ['SquadDTO', SquadDTOSchema],
  ['NominationDTO', NominationSchema],
  ['AuctionLiveSnapshot', AuctionLiveSnapshotSchema],
  ['TeamViewDTO', TeamViewSchema],
  ['ShortlistViewDTO', ShortlistViewSchema],
] as const) {
  sameSet(`dto ${name}`, shapeOf(schema), fields(dtos[name] ?? []));
}

const seen = new Set<string>();
for (const op of http) {
  const key = `${op.method} ${op.path}`;
  if (seen.has(key)) problems.push(`http: duplicate operation ${key}`);
  seen.add(key);
  if (!op.path.startsWith('/v1/') && !op.path.startsWith('/health/')) {
    problems.push(`http: '${key}' is outside the versioned /v1 prefix`);
  }
}

if (problems.length > 0) {
  console.error(`contracts:check failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.warn(
  `contracts:check ok — ${COMMAND_TYPES.length} commands, ${EVENT_TYPES.length} events, ` +
    `${Object.keys(ERROR_CODES).length} error codes, ${http.length} HTTP operations`,
);
