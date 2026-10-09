import { z } from 'zod';

export const API_VERSION = 'v1' as const;
export const SPEC_VERSION = '1.0' as const;

export const LivenessSchema = z.object({ status: z.literal('live') }).strict();

export const ReadinessCheckSchema = z
  .object({
    name: z.string(),
    ok: z.boolean(),
    detail: z.string().max(200).optional(),
  })
  .strict();

export const ReadinessSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.array(ReadinessCheckSchema),
  })
  .strict();
export type Readiness = z.infer<typeof ReadinessSchema>;

export const VersionInfoSchema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    specVersion: z.literal(SPEC_VERSION),
    contractsVersion: z.string(),
  })
  .strict();
export type VersionInfo = z.infer<typeof VersionInfoSchema>;

export const CONTRACTS_VERSION = '0.1.0';
