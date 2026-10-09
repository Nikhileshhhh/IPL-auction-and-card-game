import { EventEmitter } from 'node:events';

export type SecuritySignal =
  | { kind: 'access.revoked'; minValidVersion: string }
  | { kind: 'session.revoked'; userId: string }
  | { kind: 'user.suspended'; userId: string };

/** In-process fan-out of revocations to live sockets (single instance, ADR-014). */
export class SecurityBus {
  private readonly emitter = new EventEmitter();
  emit(signal: SecuritySignal) {
    this.emitter.emit('signal', signal);
  }
  on(listener: (signal: SecuritySignal) => void) {
    this.emitter.on('signal', listener);
    return () => this.emitter.off('signal', listener);
  }
}
