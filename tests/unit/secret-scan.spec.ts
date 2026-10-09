import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

/** Patterns for credentials that must never be committed. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
];
/** Placeholder passwords; test fixtures must use the `fixture-` prefix. */
const ALLOWED_PASSWORDS = new Set(['change-me', 'local-dev-only', 'postgres', 'password']);

function trackedAndNewFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('docs/spec/') && f !== 'pnpm-lock.yaml');
}

describe('repository secret scan', () => {
  const files = trackedAndNewFiles().filter((f) => {
    try {
      return statSync(join(ROOT, f)).size < 2_000_000;
    } catch {
      return false;
    }
  });

  it('finds no credential-shaped strings in committed files', () => {
    const findings: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const [label, pattern] of SECRET_PATTERNS) {
        if (pattern.test(text)) findings.push(`${file}: ${label}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('connection strings only carry placeholder passwords', () => {
    const findings: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const match of text.matchAll(/postgres(?:ql)?:\/\/[^:\s/@]+:([^@\s]+)@/g)) {
        if (!ALLOWED_PASSWORDS.has(match[1]!) && !match[1]!.startsWith('fixture-'))
          findings.push(`${file}: password '${match[1]!.slice(0, 2)}…'`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('no real .env file is tracked', () => {
    expect(files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'))).toEqual(
      [],
    );
  });
});
