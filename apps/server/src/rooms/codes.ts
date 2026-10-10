import { randomBytes } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  formatRoomCode,
  normalizeRoomCode,
} from '@stumps/contracts';
import { hmac } from '../security/crypto';
import type { Secrets } from '../config/secrets';

/**
 * 12 symbols from a 32-symbol alphabet = 60 bits from a CSPRNG. 32 divides 256,
 * so masking a byte to 5 bits introduces no modulo bias.
 */
export function generateRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte & 31];
  return code;
}

/** Keyed digest for indexed lookup (never store or index the plaintext code). */
export function roomCodeHash(secrets: Secrets, code: string): Buffer {
  return hmac(secrets.lookupKey, 'room-code', normalizeRoomCode(code));
}

export function sealRoomCode(secrets: Secrets, roomId: string, code: string): Buffer {
  return Buffer.from(secrets.encryptor.encrypt(code, `room-code:${roomId}`));
}

export function openRoomCode(secrets: Secrets, roomId: string, sealed: Buffer): string {
  return formatRoomCode(secrets.encryptor.decrypt(sealed.toString('utf8'), `room-code:${roomId}`));
}
