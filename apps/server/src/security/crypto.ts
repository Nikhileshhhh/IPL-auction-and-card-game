import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** 256-bit (default) URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/**
 * Keyed digest with domain separation: the same key never produces colliding
 * digests for different purposes (e.g. 'bucket:cookie' vs 'email').
 */
export function hmac(key: Buffer, purpose: string, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(purpose).update('\u0000').update(data).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Decode a base64url secret and require a minimum length. */
export function decodeKey(name: string, value: string, minBytes = 32): Buffer {
  const key = Buffer.from(value, 'base64url');
  if (key.length < minBytes) throw new Error(`${name} must decode to at least ${minBytes} bytes`);
  return key;
}

/**
 * AES-256-GCM with a key-version prefix so keys can rotate while old
 * ciphertext stays readable: `v<version>.<iv>.<ciphertext>.<tag>` (base64url).
 */
export class Encryptor {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly currentVersion: number,
  ) {
    for (const [version, key] of keys) {
      if (key.length !== 32) throw new Error(`encryption key v${version} must be 32 bytes`);
    }
    if (!keys.has(currentVersion)) throw new Error('current encryption key version missing');
  }

  encrypt(plaintext: string, associatedData = ''): string {
    const key = this.keys.get(this.currentVersion);
    if (!key) throw new Error('current encryption key missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v' + this.currentVersion, iv, ciphertext, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(sealed: string, associatedData = ''): string {
    const [versionPart, ivPart, ctPart, tagPart] = sealed.split('.');
    const version = Number(versionPart?.slice(1));
    const key = this.keys.get(version);
    if (!key || !ivPart || !ctPart || !tagPart) throw new Error('unreadable ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
