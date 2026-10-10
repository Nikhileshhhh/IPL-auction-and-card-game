import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadPhoto,
  parseBattingStyle,
  parseCountry,
  parseManifest,
} from '../../src/modules/cricket-data/manifest';

describe('player sheet parsing (ADR-019)', () => {
  it('normalizes countries and batting styles', () => {
    expect(parseCountry('India')).toBe('IN');
    expect(parseCountry('in')).toBe('IN');
    expect(parseCountry('Trinidad and Tobago')).toBe('TT');
    expect(parseCountry('Atlantis')).toBeNull();
    expect(parseBattingStyle('Right-hand bat')).toBe('right_hand');
    expect(parseBattingStyle('LHB')).toBe('left_hand');
    expect(parseBattingStyle('switch')).toBeNull();
  });

  it('requires jersey confirmation and licence details for photo rows', () => {
    const { rows, issues } = parseManifest(
      [
        'player_key,country,batting_style,bowling_style,photo,ipl_jersey,licence,licence_holder',
        'a1,IN,RHB,Right-arm fast,a1.jpg,yes,Lic #1,Founders Pvt Ltd',
        'b2,AU,LHB,does not bowl,,,,',
        'c3,IN,RHB,,c3.jpg,no,Lic #1,Founders Pvt Ltd',
        'd4,IN,RHB,,d4.jpg,yes,,',
      ].join('\n'),
    );
    expect(rows.map((r) => r.playerKey)).toEqual(['a1', 'b2']);
    expect(rows[1]!.bowlingStyle).toBeNull(); // explicit "does not bowl"
    expect(issues.map((i) => i.line)).toEqual([4, 5]);
  });

  it('local photo paths cannot escape the photos folder; URLs must be on the allowlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stumps-photos-'));
    writeFileSync(join(dir, 'ok.jpg'), 'bytes');
    const opts = { photosDir: dir, allowedHosts: ['images.example.com'], actorId: null };
    await expect(loadPhoto('ok.jpg', opts)).resolves.toBeInstanceOf(Buffer);
    await expect(loadPhoto('../etc/passwd', opts)).rejects.toThrow(/escapes/);
    await expect(loadPhoto('/etc/passwd', opts)).rejects.toThrow(/escapes/);
    await expect(loadPhoto('https://other.example.com/a.jpg', opts)).rejects.toThrow(
      /PHOTO_IMPORT_HOSTS/,
    );
    await expect(loadPhoto('http://images.example.com/a.jpg', opts)).rejects.toThrow(
      /PHOTO_IMPORT_HOSTS/,
    );
  });
});
