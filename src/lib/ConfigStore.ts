import fs from 'fs';
import path from 'path';

export type VoiceConfig = {
  opusBitrate: number; // bps
  opusFec: boolean;
  opusPlp: number; // 0..1
  maxMissedFrames: number; // audio frames (20ms)
  volume: number; // 0.0 .. 2.0 (1.0 = 100%)
  inactivityMinutes: number; // minutes, 0 disables auto-disconnect
  preferOpusDemux: boolean; // try demux fast-path for pre-encoded opus
  microFadeMs: number; // fade-in at start to avoid ticks
  autoLeaveAlone: boolean; // auto leave when alone
  aloneGraceSeconds: number; // grace before leaving when alone
};

const DEFAULTS: VoiceConfig = {
  // Slightly higher default bitrate for cleaner high-frequency content
  opusBitrate: 128_000,
  opusFec: true,
  opusPlp: 0.1,
  // Allow brief jitter without dropouts; reduces crackle on busy hosts
  maxMissedFrames: 50,
  volume: 1.0,
  inactivityMinutes: 5,
  preferOpusDemux: true,
  microFadeMs: 12,
  autoLeaveAlone: true,
  aloneGraceSeconds: 60,
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
        preferOpusDemux: typeof parsed.preferOpusDemux === 'boolean' ? parsed.preferOpusDemux : DEFAULTS.preferOpusDemux,
        microFadeMs: Math.max(0, Number(parsed.microFadeMs) || DEFAULTS.microFadeMs),
        autoLeaveAlone: typeof parsed.autoLeaveAlone === 'boolean' ? parsed.autoLeaveAlone : DEFAULTS.autoLeaveAlone,
        aloneGraceSeconds: Math.max(5, Number(parsed.aloneGraceSeconds) || DEFAULTS.aloneGraceSeconds),
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
      volume: clamp(newConfig.volume, 0, 2),
      inactivityMinutes: Math.max(0, Math.round(newConfig.inactivityMinutes)),
      preferOpusDemux: Boolean(newConfig.preferOpusDemux),
      microFadeMs: Math.max(0, Math.round(newConfig.microFadeMs)),
      autoLeaveAlone: Boolean(newConfig.autoLeaveAlone),
      aloneGraceSeconds: Math.max(5, Math.round(newConfig.aloneGraceSeconds)),
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
