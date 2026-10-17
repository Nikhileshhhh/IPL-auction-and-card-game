'use client';

/**
 * Original sound cues (UI spec §3, ADR-031), synthesized with the Web Audio
 * API: no recorded clips, no broadcast jingles, nothing to license. Sound is
 * off until the member turns it on AND the browser has seen a gesture. A cue
 * never carries information the screen does not already show, and each
 * distinct event plays at most once (a repeated or replayed event is silent).
 */

export const CUES = ['reveal', 'roundWon', 'bid', 'sold', 'unsold', 'medal', 'vote'] as const;
export type Cue = (typeof CUES)[number];

type Note = { at: number; freq: number; dur: number; type: OscillatorType; gain: number };

/** Short, quiet and distinct; the longest (medal) is under 1.2 s. */
export const CUE_NOTES: Record<Cue, readonly Note[]> = {
  reveal: [{ at: 0, freq: 660, dur: 0.09, type: 'triangle', gain: 0.12 }],
  roundWon: [
    { at: 0, freq: 523, dur: 0.1, type: 'triangle', gain: 0.12 },
    { at: 0.09, freq: 784, dur: 0.16, type: 'triangle', gain: 0.12 },
  ],
  bid: [{ at: 0, freq: 880, dur: 0.05, type: 'square', gain: 0.05 }],
  sold: [
    { at: 0, freq: 392, dur: 0.08, type: 'triangle', gain: 0.14 },
    { at: 0.12, freq: 294, dur: 0.22, type: 'triangle', gain: 0.14 },
  ],
  unsold: [{ at: 0, freq: 247, dur: 0.18, type: 'sine', gain: 0.1 }],
  medal: [
    { at: 0, freq: 523, dur: 0.14, type: 'triangle', gain: 0.12 },
    { at: 0.14, freq: 659, dur: 0.14, type: 'triangle', gain: 0.12 },
    { at: 0.28, freq: 784, dur: 0.14, type: 'triangle', gain: 0.12 },
    { at: 0.42, freq: 1047, dur: 0.5, type: 'triangle', gain: 0.1 },
  ],
  vote: [{ at: 0, freq: 587, dur: 0.07, type: 'sine', gain: 0.08 }],
};

const MEMORY = 500;
const played = new Set<string>();
const order: string[] = [];

/**
 * Records an event key; false when it was already heard. Bounded so a long
 * auction does not grow without limit.
 */
export function rememberEvent(key: string): boolean {
  if (played.has(key)) return false;
  played.add(key);
  order.push(key);
  const oldest = order.length > MEMORY ? order.shift() : undefined;
  if (oldest !== undefined) played.delete(oldest);
  return true;
}

let context: AudioContext | null = null;
let unlocked = false;

/** Call from a user gesture; browsers keep audio suspended until then. */
export function unlockAudio() {
  unlocked = true;
  if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
}

export function audioUnlocked() {
  return unlocked;
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/**
 * Plays `cue` for the event `eventKey` when sound is enabled and unlocked.
 * Returns whether a sound was scheduled. Failures are silent: audio is never
 * required to follow the game.
 */
export function playCue(cue: Cue, eventKey: string, enabled: boolean): boolean {
  // Remember first: an event that passed while muted never plays later.
  if (!rememberEvent(`${cue}:${eventKey}`)) return false;
  if (!enabled || !unlocked) return false;
  try {
    const ctx = audio();
    if (!ctx) return false;
    const start = ctx.currentTime + 0.01;
    for (const n of CUE_NOTES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, start + n.at);
      gain.gain.linearRampToValueAtTime(n.gain, start + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + n.at);
      osc.stop(start + n.at + n.dur + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** Test hook: forget heard events and the gesture. */
export function resetAudioForTests() {
  played.clear();
  order.length = 0;
  unlocked = false;
  context = null;
}
