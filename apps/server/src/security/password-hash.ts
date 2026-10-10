import argon2 from 'argon2';
import { createHmac } from 'node:crypto';

/**
 * Argon2id with a server-held, versioned pepper (OWASP; DB/realtime §2.2).
 * Starting parameters: 19 MiB, 2 iterations, parallelism 1 — benchmark and
 * tune at deployment. Hashing concurrency is bounded so a burst of guesses
 * cannot exhaust memory.
 */
export const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

export class PasswordHasher {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly peppers: ReadonlyMap<number, Buffer>,
    private readonly currentPepper: number,
    private readonly maxConcurrent = 2,
  ) {
    if (!peppers.has(currentPepper)) throw new Error('current pepper version missing');
  }

  get pepperVersion(): number {
    return this.currentPepper;
  }

  private peppered(secret: string, version: number): Buffer {
    const pepper = this.peppers.get(version);
    if (!pepper) throw new Error(`pepper v${version} unavailable`);
    return createHmac('sha256', pepper).update(secret.normalize('NFKC')).digest();
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private dummy?: Promise<string>;

  /** Same verification cost when there is nothing to compare against (unknown room/account). */
  async verifyNothing(secret: string): Promise<false> {
    this.dummy ??= this.hash(`dummy:${Math.random()}`);
    await this.verify(await this.dummy, secret);
    return false;
  }

  hash(secret: string): Promise<string> {
    return this.slot(() => argon2.hash(this.peppered(secret, this.currentPepper), ARGON2_PARAMS));
  }

  /** Constant-work verification; never throws on mismatch or malformed hashes. */
  verify(hash: string, secret: string, pepperVersion = this.currentPepper): Promise<boolean> {
    return this.slot(async () => {
      try {
        return await argon2.verify(hash, this.peppered(secret, pepperVersion));
      } catch {
        return false;
      }
    });
  }
}
