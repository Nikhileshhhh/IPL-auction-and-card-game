import { concat, hmacSha256, sha256, toHex, utf8 } from './sha256';

/**
 * Committed randomness, rng_version `hmac-sha256-ctr-v1` (rules §4, ADR-021).
 *
 * - The backend draws a 256-bit seed (engines never create randomness) and
 *   publishes `SHA256(seed ‖ utf8(roomNonce) ‖ utf8(configHash))` before dealing.
 * - Independent streams per label (`deal`, `seats`, `fallback`): block k is
 *   `HMAC-SHA256(key = seed, msg = utf8(label) ‖ 0x00 ‖ uint64_be(k))`, k = 0, 1, …
 * - Blocks are consumed 4 bytes at a time as big-endian uint32 values.
 * - `uniform(n)` uses rejection sampling below the largest multiple of n under 2^32
 *   (no modulo bias); shuffles are Fisher–Yates from the top index down.
 */
export const RNG_VERSION = 'hmac-sha256-ctr-v1';
export const STREAM_LABELS = ['deal', 'seats', 'fallback', 'lots'] as const;
export type StreamLabel = (typeof STREAM_LABELS)[number];

const TWO_32 = 0x1_0000_0000;

export function seedCommitment(seed: Uint8Array, roomNonce: string, configHash: string): string {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  return toHex(sha256(concat(seed, utf8(roomNonce), utf8(configHash))));
}

export class RandomStream {
  private counter = 0;
  private block: Uint8Array = new Uint8Array(0);
  private offset = 0;
  /** uint32 values consumed so far (persisted with the match for audit). */
  draws = 0;

  constructor(
    private readonly seed: Uint8Array,
    readonly label: StreamLabel,
  ) {
    if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  }

  private nextBlock() {
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(0, BigInt(this.counter));
    this.counter += 1;
    this.block = hmacSha256(this.seed, concat(utf8(this.label), Uint8Array.of(0), counter));
    this.offset = 0;
  }

  nextUint32(): number {
    if (this.offset + 4 > this.block.length) this.nextBlock();
    const v = new DataView(this.block.buffer, this.block.byteOffset).getUint32(this.offset);
    this.offset += 4;
    this.draws += 1;
    return v;
  }

  /** Uniform integer in [0, n). */
  uniform(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n > TWO_32) throw new Error('uniform: bad bound');
    const limit = TWO_32 - (TWO_32 % n);
    for (;;) {
      const v = this.nextUint32();
      if (v < limit) return v % n;
    }
  }

  /** Fisher–Yates; returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.uniform(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}

export function streams(seed: Uint8Array): Record<StreamLabel, RandomStream> {
  return {
    deal: new RandomStream(seed, 'deal'),
    seats: new RandomStream(seed, 'seats'),
    fallback: new RandomStream(seed, 'fallback'),
    lots: new RandomStream(seed, 'lots'),
  };
}

/** SHA-256 hex of a string (cycle-guard state keys). */
export const sha256Hex = (text: string) => toHex(sha256(utf8(text)));
