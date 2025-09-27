import fs from 'fs';
import path from 'path';

export type VoiceConfig = {
  opusBitrate: number; // bps
  opusFec: boolean;
  opusPlp: number; // 0..1
  maxMissedFrames: number; // audio frames (20ms)
  volume: number; // 0.0 .. 2.0 (1.0 = 100%)
  inactivityMinutes: number; // minutes, 0 disables auto-disconnect
};

const DEFAULTS: VoiceConfig = {
  opusBitrate: 96_000,
  opusFec: true,
  opusPlp: 0.1,
  maxMissedFrames: 5,
  volume: 1.0,
  inactivityMinutes: 5,
};

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

let cache: VoiceConfig = { ...DEFAULTS };

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function load(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      cache = {
        opusBitrate: Number(parsed.opusBitrate) || DEFAULTS.opusBitrate,
        opusFec: Boolean(parsed.opusFec),
        opusPlp: clamp(Number(parsed.opusPlp) || DEFAULTS.opusPlp, 0, 1),
        maxMissedFrames:
          Number(parsed.maxMissedFrames) || DEFAULTS.maxMissedFrames,
        volume: clamp(Number(parsed.volume) || DEFAULTS.volume, 0, 2),
        inactivityMinutes:
          Math.max(0, Number(parsed.inactivityMinutes) || DEFAULTS.inactivityMinutes),
      };
    }
  } catch (e) {
    // Keep defaults on error
  }
}

function save(): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // ignore write errors (ephemeral FS, permissions, etc.)
  }
}

// Load on module import
load();

export const ConfigStore = {
  get(): VoiceConfig {
    return { ...cache };
  },
  set(newConfig: VoiceConfig): VoiceConfig {
    cache = {
      opusBitrate: Math.round(newConfig.opusBitrate),
      opusFec: Boolean(newConfig.opusFec),
      opusPlp: clamp(newConfig.opusPlp, 0, 1),
      maxMissedFrames: Math.max(1, Math.round(newConfig.maxMissedFrames)),
    };
    save();
    return this.get();
  },
  update(partial: Partial<VoiceConfig>): VoiceConfig {
    return this.set({ ...cache, ...partial });
  },
  path(): string {
    return CONFIG_PATH;
  },
};
