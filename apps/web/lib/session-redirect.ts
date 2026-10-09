import 'server-only';
import { redirect } from 'next/navigation';

/** Map server authorization failures to the correct entry screen. */
export function redirectForSessionError(code: string): never {
  if (code === 'GATE_REQUIRED' || code === 'GATE_INVALID') redirect('/access');
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_REVOKED' || code === 'BANNED')
    redirect('/auth');
  throw new Error('The game server is temporarily unavailable.');
}
