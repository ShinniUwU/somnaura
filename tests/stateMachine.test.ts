import { describe, it, expect } from 'bun:test';
import { PlaybackStateMachine } from '../src/lib/PlaybackStateMachine';

describe('PlaybackStateMachine', () => {
  it('allows valid transitions', () => {
    const sm = new PlaybackStateMachine();
    expect(sm.getState()).toBe('IDLE');
    expect(sm.transition('JOINING')).toBe('JOINING');
    expect(sm.transition('READY')).toBe('READY');
    expect(sm.transition('PLAYING')).toBe('PLAYING');
    expect(sm.transition('STOPPING')).toBe('STOPPING');
    expect(sm.transition('READY')).toBe('READY');
  });

  it('rejects invalid transitions', () => {
    const sm = new PlaybackStateMachine();
    expect(() => sm.transition('PLAYING')).toThrow();
    sm.transition('JOINING');
    expect(() => sm.transition('PLAYING')).toThrow();
  });
});
