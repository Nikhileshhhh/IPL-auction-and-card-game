const ALLOWED_PREFIXES = [
  '/play',
  '/players',
  '/friends',
  '/notifications',
  '/rooms',
  '/onboarding',
  '/auth/callback',
  '/auth/reset',
];

/** Only same-site relative paths under known areas; never protocol-relative or external. */
export function safeNext(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  const path = value.split('?')[0] ?? '';
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? value : fallback;
}
