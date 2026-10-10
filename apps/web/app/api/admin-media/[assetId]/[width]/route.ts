import type { NextRequest } from 'next/server';
import { proxyPortrait } from '@/lib/bff/media';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string; width: string }> },
) {
  return proxyPortrait(request, await context.params, 'admin');
}
