import { describe, it, expect } from 'bun:test';
import { SongQueue } from '../src/lib/SongQueue';

const makeSong = (name: string) => ({ name, path: `/tmp/${name}.mp3` });

describe('SongQueue', () => {
  it('enqueues and dequeues in order', () => {
    const q = new SongQueue();
    q.enqueue(makeSong('a'));
    q.enqueue(makeSong('b'));
    expect(q.size()).toBe(2);
    expect(q.dequeue()?.name).toBe('a');
    expect(q.dequeue()?.name).toBe('b');
    expect(q.dequeue()).toBeUndefined();
  });

  it('lists and clears', () => {
    const q = new SongQueue();
    q.enqueue(makeSong('x'));
    q.enqueue(makeSong('y'));
    expect(q.list().map((s) => s.name)).toEqual(['x', 'y']);
    q.clear();
    expect(q.size()).toBe(0);
  });
});
