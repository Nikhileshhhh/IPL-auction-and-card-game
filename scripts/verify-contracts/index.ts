/**
 * pnpm contracts:check — verifies the machine-readable catalogs in
 * packages/contracts/schema/*.json agree with the TypeScript contracts
 * that the server and web app actually import.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMAND_TYPES, ERROR_CODES, EVENT_TYPES } from '../../packages/contracts/src/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaDir = join(root, 'packages', 'contracts', 'schema');
const load = <T>(file: string): T => JSON.parse(readFileSync(join(schemaDir, file), 'utf8')) as T;

type CommandCatalog = { commands: Record<string, { events: string[]; errors: string[] }> };
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
