import type { LoggerOptions } from 'pino';

/**
 * Paths that must never reach logs (master §9.3): credentials, codes, tickets,
 * cookies, chat bodies, strategy ceilings, RNG seeds and deck order.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.code',
  '*.accessCode',
  '*.newCode',
  '*.roomCode',
  '*.franchiseCode',
  '*.token',
  '*.ticket',
  '*.refreshToken',
  '*.accessToken',
  '*.seed',
  '*.deckOrder',
  '*.text',
  '*.body',
  '*.strategy',
  '*.maxPrice',
];

export function loggerOptions(level: LoggerOptions['level']): LoggerOptions {
  return {
    level: level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'stumps-server' },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
