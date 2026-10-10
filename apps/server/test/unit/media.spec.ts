import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processPortrait, sniffImage } from '../../src/modules/media/pipeline';
import { LocalDiskStorage } from '../../src/modules/media/storage';

describe('upload hardening (E65)', () => {
  it('sniffs magic bytes and ignores claimed types', () => {
    expect(
      sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')),
    ).toBeNull();
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('rejects polyglots and truncated files that only look like images', async () => {
    const fakePng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<script>alert(1)</script>'.repeat(10)),
    ]);
    await expect(processPortrait(fakePng)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects oversize and tiny images', async () => {
    await expect(processPortrait(Buffer.alloc(2 * 1024 * 1024 + 1, 1))).rejects.toMatchObject({
      details: { reason: 'IMAGE_SIZE' },
    });
    const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    await expect(processPortrait(tiny)).rejects.toMatchObject({
      details: { reason: 'IMAGE_SMALL' },
    });
  });

  it('re-encodes to exact WebP variants with no metadata', async () => {
    const jpeg = await sharp({
      create: { width: 1000, height: 700, channels: 3, background: '#a33' },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } })
      .toBuffer();
    const out = await processPortrait(jpeg);
    for (const [width, bytes] of out.variants) {
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(width);
      expect(meta.height).toBe(Math.round((width * 4) / 3));
      expect(meta.exif).toBeUndefined();
    }
  });

  it('storage keys cannot traverse outside the media root', async () => {
    const storage = new LocalDiskStorage(mkdtempSync(join(tmpdir(), 'stumps-media-')));
    await expect(storage.put('../escape.webp', Buffer.from('x'))).rejects.toThrow(
      /invalid media key/,
    );
    await expect(storage.put('portraits/../../etc/x', Buffer.from('x'))).rejects.toThrow(
      /invalid media key/,
    );
    await expect(storage.get('/etc/passwd')).resolves.toBeNull();
    await storage.put('portraits/abc/320.webp', Buffer.from('ok'));
    expect((await storage.get('portraits/abc/320.webp'))?.toString()).toBe('ok');
  });
});
