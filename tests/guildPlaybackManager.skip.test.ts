import { describe, it, expect } from 'bun:test';
import { GuildPlaybackManager } from '../src/lib/GuildPlaybackManager';

const makeSong = (name: string) => ({ name, path: `/tmp/${name}.ogg` });

describe('GuildPlaybackManager skip', () => {
  it('does not dequeue the next track directly inside skip', async () => {
    const manager = new GuildPlaybackManager('guild-test', () => {});
    const mgr = manager as any;
    mgr.currentSong = makeSong('current');
    mgr.fadeOutStop = async () => {};

    manager.enqueue(makeSong('next'));

    const message = await manager.skip(0);
    expect(message).toBe('Skipped. Next up: next');
    expect(manager.getQueue().map((s) => s.name)).toEqual(['next']);

    manager.destroy();
  });

  it('reports empty queue after skip when nothing is queued', async () => {
    const manager = new GuildPlaybackManager('guild-test', () => {});
    const mgr = manager as any;
    mgr.currentSong = makeSong('current');
    mgr.fadeOutStop = async () => {};

    const message = await manager.skip(0);
    expect(message).toBe('Skipped. Queue is empty.');
    manager.destroy();
  });
});
