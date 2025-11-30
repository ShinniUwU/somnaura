import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigStore } from '../src/lib/ConfigStore';

const originalPath = ConfigStore.path();

describe('ConfigStore', () => {
  afterAll(() => {
    ConfigStore.setPathForTest(originalPath);
  });

  it('loads and preserves zero values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    const cfgPath = path.join(tmp, 'config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        opusBitrate: 0,
        opusFec: false,
        opusPlp: 0,
        maxMissedFrames: 0,
        inactivityMinutes: 0,
        preferOpusDemux: false,
        microFadeMs: 0,
        autoLeaveAlone: false,
        aloneGraceSeconds: 5,
      }),
    );
    ConfigStore.setPathForTest(cfgPath);
    const cfg = ConfigStore.get();
    expect(cfg.opusBitrate).toBe(0);
    expect(cfg.opusPlp).toBe(0);
    expect(cfg.inactivityMinutes).toBe(0);
  });
});
