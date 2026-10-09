import { z } from 'zod';
import { IsoTimestamp, Uuid } from './primitives';

/** Usernames: 3–24 of [a-z0-9_] (DB/realtime §5.1 profiles). */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, 'Use 3–24 lowercase letters, numbers or underscores.');

export const DisplayNameSchema = z.string().trim().min(1).max(50);
export const BioSchema = z.string().trim().max(240);
export const ProfileVisibilitySchema = z.enum(['members', 'friends', 'private']);

/** Passwords and website/room codes: 12–128 characters, passphrases welcome (DB §2.2). */
export const PasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.');

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .pipe(z.string().max(254));

/** Website access code as typed by a visitor. Never logged or stored in plaintext. */
export const AccessCodeSchema = z.string().min(1).max(128);

export const AccessVerifyRequestSchema = z
  .object({
    code: AccessCodeSchema,
    // Fresh UUID per deliberate guess; a retry with the same ID replays the outcome.
    requestId: Uuid,
  })
  .strict();
export type AccessVerifyRequest = z.infer<typeof AccessVerifyRequestSchema>;

export const GateStatusSchema = z.enum([
  'none',
  'preauth',
  'bound',
  'locked',
  'closed',
  'expired',
  'revoked',
]);
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const AttemptStatusSchema = z
  .object({
    gateStatus: GateStatusSchema,
    remainingAttempts: z.number().int().min(0).max(3),
    lockedUntil: IsoTimestamp.optional(),
    grantExpiresAt: IsoTimestamp.optional(),
  })
  .strict();
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

export const EnrollRequestSchema = z.object({ email: EmailSchema }).strict();
export const LoginRequestSchema = z
  .object({ email: EmailSchema, password: z.string().min(1).max(128) })
  .strict();
export const RecoveryRequestSchema = z.object({ email: EmailSchema }).strict();
export const LogoutRequestSchema = z
  .object({ scope: z.enum(['current', 'all']).default('current') })
  .strict();

export const OnboardingRequestSchema = z
  .object({
    username: UsernameSchema,
    displayName: DisplayNameSchema,
    bio: BioSchema.optional(),
    visibility: ProfileVisibilitySchema,
    activityVisible: z.boolean(),
  })
  .strict();
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

/** Minimal session projection handed to client components (no tokens, no email). */
export const SessionProjectionSchema = z
  .object({
    userId: Uuid,
    username: z.string(),
    displayName: z.string(),
    onboarded: z.boolean(),
    gate: z.object({ status: GateStatusSchema, expiresAt: IsoTimestamp.optional() }).strict(),
  })
  .strict();
export type SessionProjection = z.infer<typeof SessionProjectionSchema>;

export const InviteCallbackRequestSchema = z
  .object({
    tokenHash: z.string().min(16).max(256),
    enrollment: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const SetPasswordRequestSchema = z.object({ password: PasswordSchema }).strict();
export const RecoveryCompleteRequestSchema = z
  .object({ tokenHash: z.string().min(16).max(256), password: PasswordSchema })
  .strict();
export const UsernameAvailabilitySchema = z
  .object({ available: z.boolean(), suggestion: z.string().optional() })
  .strict();

export const AccessRotationRequestSchema = z
  .object({
    newCode: PasswordSchema.optional(),
    generate: z.boolean().optional(),
    expiresAt: IsoTimestamp.nullable(),
    windowSeconds: z.number().int().min(60).max(86400),
    lockoutSeconds: z.number().int().min(60).max(86400),
    rotationPolicy: z.enum(['REVOKE_EXISTING', 'PRESERVE_EXISTING']),
    version: z.string().regex(/^[1-9][0-9]{0,18}$/),
  })
  .strict()
  .refine((v) => Boolean(v.newCode) !== Boolean(v.generate), {
    message: 'Provide a new code or request a generated one.',
  });

export const AdminLoginResultSchema = z
  .object({ mfaRequired: z.literal(true), factorId: z.string().optional() })
  .strict();
export const AdminMfaRequestSchema = z
  .object({
    factorId: z.string().min(1).max(64),
    challengeId: z.string().min(1).max(64),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const SocketTicketResponseSchema = z
  .object({ ticket: z.string().min(32), expiresAt: IsoTimestamp })
  .strict();
export const AdminChallengeRequestSchema = z
  .object({ factorId: z.string().min(1).max(64) })
  .strict();
