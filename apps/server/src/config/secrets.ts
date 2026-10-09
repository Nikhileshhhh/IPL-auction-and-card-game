import { Encryptor, decodeKey } from '../security/crypto';
import { PasswordHasher } from '../security/password-hash';
import type { ServerEnv } from './env';

export interface Secrets {
  bffSigningKey: Buffer;
  lookupKey: Buffer;
  encryptor: Encryptor;
  accessCodeHasher: PasswordHasher;
  roomPasswordHasher: PasswordHasher;
}

const REQUIRED = [
  'BFF_SIGNING_KEY',
  'ACCESS_CODE_PEPPER_V1',
  'ROOM_PASSWORD_PEPPER_V1',
  'INVITE_LOOKUP_HMAC_KEY',
  'DATA_ENCRYPTION_KEY_V1',
] as const;

/**
 * Materialize secrets once at startup. Missing secrets are a configuration
 * error in every environment (no hardcoded or ephemeral fallbacks); local
 * development generates them with `pnpm setup:env`.
 */
export function loadSecrets(env: ServerEnv): Secrets {
  const required = (name: (typeof REQUIRED)[number]): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing required secret ${name}`);
    return value;
  };
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required secrets: ${missing.join(', ')} (run pnpm setup:env for local development)`,
    );
  }
  const encryptionKey = decodeKey('DATA_ENCRYPTION_KEY_V1', required('DATA_ENCRYPTION_KEY_V1'));
  if (encryptionKey.length !== 32)
    throw new Error('DATA_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes');
  return {
    bffSigningKey: decodeKey('BFF_SIGNING_KEY', required('BFF_SIGNING_KEY')),
    lookupKey: decodeKey('INVITE_LOOKUP_HMAC_KEY', required('INVITE_LOOKUP_HMAC_KEY')),
    encryptor: new Encryptor(new Map([[1, encryptionKey]]), 1),
    accessCodeHasher: new PasswordHasher(
      new Map([[1, decodeKey('ACCESS_CODE_PEPPER_V1', required('ACCESS_CODE_PEPPER_V1'))]]),
      1,
    ),
    roomPasswordHasher: new PasswordHasher(
      new Map([[1, decodeKey('ROOM_PASSWORD_PEPPER_V1', required('ROOM_PASSWORD_PEPPER_V1'))]]),
      1,
    ),
  };
}
