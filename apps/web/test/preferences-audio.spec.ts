import { afterEach, describe, expect, it } from 'vitest';
import { lowDataSrc } from '../components/cards/portrait-src';
import {
  CUE_NOTES,
  CUES,
  playCue,
  rememberEvent,
  resetAudioForTests,
  unlockAudio,
} from '../features/audio/sfx';
import { motionReduced } from '../features/preferences/store';

afterEach(() => resetAudioForTests());

describe('sound cues (ADR-031)', () => {
  it('each event key is heard once, however often it is replayed', () => {
    expect(rememberEvent('bid:lot-1:7')).toBe(true);
    expect(rememberEvent('bid:lot-1:7')).toBe(false);
    expect(rememberEvent('bid:lot-1:8')).toBe(true);
  });

  it('stays silent until enabled and unlocked, and a muted event never plays later', () => {
    // Muted: the event is consumed, so turning sound on does not replay it.
    expect(playCue('sold', 'n-1', false)).toBe(false);
    unlockAudio();
    expect(playCue('sold', 'n-1', true)).toBe(false);
    // No gesture yet: nothing plays even when enabled.
    resetAudioForTests();
    expect(playCue('sold', 'n-2', true)).toBe(false);
    expect(playCue('sold', 'n-2', true)).toBe(false);
  });

  it('remembers a bounded number of events', () => {
    for (let i = 0; i < 600; i += 1) rememberEvent(`k:${i}`);
    // The oldest keys were forgotten; recent ones are still remembered.
    expect(rememberEvent('k:0')).toBe(true);
    expect(rememberEvent('k:599')).toBe(false);
  });

  it('every cue is short and quiet', () => {
    for (const cue of CUES) {
      const notes = CUE_NOTES[cue];
      const end = Math.max(...notes.map((n) => n.at + n.dur));
      expect(end, cue).toBeLessThan(1.2);
      for (const n of notes) expect(n.gain, cue).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('motion and low-data preferences', () => {
  it('reduce and full override the device; system follows it', () => {
    expect(motionReduced({ motion: 'reduce' })).toBe(true);
    expect(motionReduced({ motion: 'full' })).toBe(false);
    // No window in this test environment: the device is treated as "no preference".
    expect(motionReduced({ motion: 'system' })).toBe(false);
  });

  it('low data asks for the 320 px portrait and leaves other images alone', () => {
    const id = '0c4a2c1e-6f7b-4e2a-9c51-2b8f3d9a1e77';
    expect(lowDataSrc(`/api/media/${id}/640`)).toBe(`/api/media/${id}/320`);
    expect(lowDataSrc(`/api/media/${id}/960`)).toBe(`/api/media/${id}/320`);
    expect(lowDataSrc(`/api/media/${id}/320`)).toBe(`/api/media/${id}/320`);
    expect(lowDataSrc('/original-assets/silhouette.svg')).toBe('/original-assets/silhouette.svg');
    expect(lowDataSrc(`https://evil.example/api/media/${id}/640`)).toBe(
      `https://evil.example/api/media/${id}/640`,
    );
  });
});
