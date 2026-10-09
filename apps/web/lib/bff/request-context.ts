import 'server-only';
import { bffConfig } from './config';

/**
 * The browser IP as attested by the hosting edge (Vercel sets x-real-ip).
 * Browser-supplied forwarding headers are not trusted beyond this setting;
 * the API additionally never trusts any forwarding header itself.
 */
export function clientIpFrom(get: (name: string) => string | null): string {
  const mode = bffConfig().clientIpHeader;
  if (mode === 'x-real-ip') return get('x-real-ip')?.trim() || '127.0.0.1';
  if (mode === 'x-forwarded-for')
    return get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  return '127.0.0.1';
}
