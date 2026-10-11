import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

const OriginList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

/** base64url secret of at least 32 bytes. Values are never echoed in errors. */
const Base64Secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')
  .refine(
    (value) => Buffer.from(value, 'base64url').length >= 32,
    'must decode to at least 32 bytes',
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    APP_ORIGIN: z.url().default('http://localhost:3000'),
    ALLOWED_ORIGINS: OriginList.optional(),
    AUTH_PROVIDER: z.enum(['supabase', 'local']).optional(),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_JWT_ISSUER: z.url().optional(),
    SUPABASE_JWKS_URL: z.url().optional(),
    LOCAL_AUTH_JWT_SECRET: z.string().min(32).optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    AUTH_REDIRECT_ORIGIN: z.url().optional(),
    // Secrets (base64url). Required whenever the API serves /v1 traffic.
    BFF_SIGNING_KEY: Base64Secret.optional(),
    ACCESS_CODE_PEPPER_V1: Base64Secret.optional(),
    ROOM_PASSWORD_PEPPER_V1: Base64Secret.optional(),
    INVITE_LOOKUP_HMAC_KEY: Base64Secret.optional(),
    DATA_ENCRYPTION_KEY_V1: Base64Secret.optional(),
    // Private media storage (player portraits). Local disk for dev/test; Supabase in production.
    MEDIA_STORAGE: z.enum(['local', 'supabase']).default('local'),
    MEDIA_DIR: z.string().min(1).default('.local/media'),
    MEDIA_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]{3,63}$/)
      .default('catalog-media'),
    // Cricsheet archive location for imports (downloaded by scripts/data/fetch-cricsheet.ts).
    CRICSHEET_DIR: z.string().min(1).default('data/raw/cricsheet'),
    // Hosts the player sheet may download licensed IPL-jersey photos from (comma list).
    PHOTO_IMPORT_HOSTS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter((h) => /^[a-z0-9.-]+$/.test(h)),
      ),
  })
  .transform((env) => ({
    ...env,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? [env.APP_ORIGIN],
  }))
  .superRefine((env, ctx) => {
    if (env.AUTH_PROVIDER === 'supabase' && (!env.SUPABASE_JWT_ISSUER || !env.SUPABASE_JWKS_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SUPABASE_JWKS_URL'],
        message: 'SUPABASE_JWT_ISSUER and SUPABASE_JWKS_URL are required for the supabase provider',
      });
    }
    if (env.AUTH_PROVIDER === 'local' && !env.LOCAL_AUTH_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCAL_AUTH_JWT_SECRET'],
        message: 'required for the local provider',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.AUTH_PROVIDER !== 'supabase') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_PROVIDER'],
        message: 'production requires supabase',
      });
    }
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' });
    }
    if (env.MEDIA_STORAGE !== 'supabase') {
      // Render's disk is ephemeral; portraits must live in private Supabase Storage.
      ctx.addIssue({
        code: 'custom',
        path: ['MEDIA_STORAGE'],
        message: 'production requires supabase',
      });
    }
    for (const key of [
      'BFF_SIGNING_KEY',
      'ACCESS_CODE_PEPPER_V1',
      'ROOM_PASSWORD_PEPPER_V1',
      'INVITE_LOOKUP_HMAC_KEY',
      'DATA_ENCRYPTION_KEY_V1',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ] as const) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
    for (const origin of env.ALLOWED_ORIGINS) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOWED_ORIGINS'],
          message: 'production origins must use https',
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof EnvSchema>;

/**
 * Validate process environment once at startup. The error lists variable
 * names and problems only — never values, which may be secrets.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server environment: ${problems}`);
  }
  const root = workspaceRoot(process.cwd());
  return {
    ...result.data,
    MEDIA_DIR: fromRoot(root, result.data.MEDIA_DIR),
    CRICSHEET_DIR: fromRoot(root, result.data.CRICSHEET_DIR),
  };
}

/**
 * Nearest directory at or above `start` holding pnpm-workspace.yaml (else `start`).
 * The dev API runs from apps/server while data scripts run from the repo root;
 * relative data paths resolve against the workspace root so both share one folder.
 */
export function workspaceRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

const fromRoot = (root: string, path: string) => (isAbsolute(path) ? path : join(root, path));
