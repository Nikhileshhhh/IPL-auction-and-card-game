import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SERVER_ONLY = [
  /from ['"]@stumps\/game-engines/,
  /from ['"]@stumps\/server/,
  /from ['"]pg['"]/,
  /from ['"]argon2['"]/,
  /from ['"]socket\.io['"]/,
  /from ['"](\.\.\/)+.*apps\/server/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('dependency boundaries (ADR-004)', () => {
  const webFiles = walk(join(ROOT, 'apps', 'web'));

  it('web source never imports server-only packages', () => {
    const offenders = webFiles.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return SERVER_ONLY.some((pattern) => pattern.test(src));
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('web package.json does not depend on server-only packages', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const forbidden of [
      '@stumps/game-engines',
      '@stumps/server',
      'pg',
      'argon2',
      'socket.io',
    ]) {
      expect(deps).not.toContain(forbidden);
    }
  });

  it('browser-safe packages do not import node built-ins or server packages', () => {
    const files = [
      ...walk(join(ROOT, 'packages', 'contracts', 'src')),
      ...walk(join(ROOT, 'packages', 'ui', 'src')),
    ];
    const offenders = files.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return /from ['"]node:/.test(src) || SERVER_ONLY.some((p) => p.test(src));
    });
    expect(offenders).toEqual([]);
  });

  it('client components never import server-only env modules', () => {
    const offenders = webFiles.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return /^['"]use client['"]/m.test(src) && /env\.server/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('only allowlisted NEXT_PUBLIC_ variables are referenced', () => {
    const allowed = new Set(['NEXT_PUBLIC_SOCKET_URL']);
    const used = new Set<string>();
    for (const file of webFiles) {
      for (const match of readFileSync(file, 'utf8').matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g))
        used.add(match[0]);
    }
    expect([...used].filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('pure engines do not read wall-clock time or draw their own randomness', () => {
    const files = walk(join(ROOT, 'packages', 'game-engines', 'src'));
    const offenders = files.filter((file) =>
      /Date\.now\(|Math\.random\(|new Date\(\)|randomBytes|randomUUID|randomInt|getRandomValues/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('.env.example contains no real-looking secrets', () => {
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(env).not.toMatch(/sk_live|service_role\s*=\s*ey|-----BEGIN/);
  });
});
