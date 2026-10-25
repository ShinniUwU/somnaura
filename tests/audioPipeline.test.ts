import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAudioResource } from '@discordjs/voice';
import { checkAudioDeps } from '../src/utils/preflight';

let dir: string;
let file: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somnaura-'));
  file = path.join(dir, 'pink.mp3');
  const gen = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=2', file]);
  if (gen.status !== 0) throw new Error(`ffmpeg failed to generate test audio: ${gen.stderr}`);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('audio pipeline', () => {
  it('has every audio dependency the bot needs', () => {
    expect(checkAudioDeps()).toEqual([]);
  });

  it('turns a song file into opus packets the same way play() does', async () => {
    const resource = createAudioResource(file, { inlineVolume: true });
    expect(resource.encoder).toBeDefined();
    expect(resource.volume).toBeDefined();

    const packets = await new Promise<number>((resolve, reject) => {
      let n = 0;
      resource.playStream.on('data', () => {
        if (++n === 50) resolve(n);
      });
      resource.playStream.on('error', reject);
      resource.playStream.on('end', () => resolve(n));
    });
    resource.playStream.destroy();

    expect(packets).toBe(50);
  });
});
