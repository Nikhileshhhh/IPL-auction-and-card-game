import 'server-only';
import { z } from 'zod';

const Base64Secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((v) => Buffer.from(v, 'base64url').length >= 32, 'must decode to at least 32 bytes');

const BffEnvSchema = z.object({
  INTERNAL_API_URL: z.url().default('http://127.0.0.1:4000'),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
  BFF_SIGNING_KEY: Base64Secret,
  CSRF_SIGNING_KEY: Base64Secret,
  /** How to learn the browser IP from the hosting edge: Vercel sets x-real-ip. */
  CLIENT_IP_HEADER: z.enum(['x-real-ip', 'x-forwarded-for', 'none']).default('x-real-ip'),
});

export interface BffConfig {
  apiUrl: string;
  appOrigin: string;
  signingKey: Buffer;
  csrfKey: Buffer;
  clientIpHeader: 'x-real-ip' | 'x-forwarded-for' | 'none';
  secureCookies: boolean;
}

let cached: BffConfig | undefined;

/** Server-only BFF configuration; never exposed to client bundles. */
export function bffConfig(): BffConfig {
  if (cached) return cached;
  const parsed = BffEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid BFF environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const env = parsed.data;
  cached = {
    apiUrl: env.INTERNAL_API_URL.replace(/\/$/, ''),
    appOrigin: new URL(env.APP_ORIGIN).origin,
    signingKey: Buffer.from(env.BFF_SIGNING_KEY, 'base64url'),
    csrfKey: Buffer.from(env.CSRF_SIGNING_KEY, 'base64url'),
    clientIpHeader: env.CLIENT_IP_HEADER,
    secureCookies: env.APP_ORIGIN.startsWith('https://'),
  };
  return cached;
}
