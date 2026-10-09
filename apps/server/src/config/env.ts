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
  })
  .transform((env) => ({
    ...env,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? [env.APP_ORIGIN],
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
