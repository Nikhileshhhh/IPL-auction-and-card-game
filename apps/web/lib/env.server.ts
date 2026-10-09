import 'server-only';
import { z } from 'zod';

/**
 * Server-only web environment. Never prefix these with NEXT_PUBLIC_; the
 * dependency-boundary test fails the build if this module is imported by a
 * client component.
 */
const WebServerEnvSchema = z.object({
  INTERNAL_API_URL: z.url().default('http://127.0.0.1:4000'),
  APP_ORIGIN: z.url().default('http://localhost:3000'),
});

export type WebServerEnv = z.infer<typeof WebServerEnvSchema>;

export function webServerEnv(): WebServerEnv {
  const parsed = WebServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid web server environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  return parsed.data;
}
