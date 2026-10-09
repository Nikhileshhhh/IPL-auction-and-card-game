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
  return result.data;
}
