import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export type VoiceConfig = {
  opusBitrate: number; // bps
  opusFec: boolean;
  opusPlp: number; // 0..1
  maxMissedFrames: number; // audio frames (20ms)
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
  inactivityMinutes: 5,
  preferOpusDemux: true,
  microFadeMs: 12,
  autoLeaveAlone: true,
  aloneGraceSeconds: 60,
};

let CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

let cache: VoiceConfig = { ...DEFAULTS };

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function load(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const parsedBitrate = Number(parsed.opusBitrate);
      const parsedPlp = Number(parsed.opusPlp);
      const parsedMaxMissed = Number(parsed.maxMissedFrames);
      const parsedInactivity = Number(parsed.inactivityMinutes);
      const parsedMicroFade = Number(parsed.microFadeMs);
      const parsedAloneGrace = Number(parsed.aloneGraceSeconds);
      cache = {
        opusBitrate: isFiniteNumber(parsedBitrate)
          ? parsedBitrate
          : DEFAULTS.opusBitrate,
        opusFec:
          typeof parsed.opusFec === 'boolean'
            ? parsed.opusFec
            : DEFAULTS.opusFec,
        opusPlp: isFiniteNumber(parsedPlp)
          ? clamp(parsedPlp, 0, 1)
          : DEFAULTS.opusPlp,
        maxMissedFrames: isFiniteNumber(parsedMaxMissed)
          ? parsedMaxMissed
          : DEFAULTS.maxMissedFrames,
        inactivityMinutes: isFiniteNumber(parsedInactivity)
          ? Math.max(0, parsedInactivity)
          : DEFAULTS.inactivityMinutes,
        preferOpusDemux:
          typeof parsed.preferOpusDemux === 'boolean'
            ? parsed.preferOpusDemux
            : DEFAULTS.preferOpusDemux,
        microFadeMs: isFiniteNumber(parsedMicroFade)
          ? Math.max(0, parsedMicroFade)
          : DEFAULTS.microFadeMs,
        autoLeaveAlone:
          typeof parsed.autoLeaveAlone === 'boolean'
            ? parsed.autoLeaveAlone
            : DEFAULTS.autoLeaveAlone,
        aloneGraceSeconds: isFiniteNumber(parsedAloneGrace)
          ? Math.max(5, parsedAloneGrace)
          : DEFAULTS.aloneGraceSeconds,
      };
    }
  } catch (e) {
    // Keep defaults on error, but surface for visibility
    logger.warn('Failed to load config.json, using defaults.', { scope: 'config' }, e);
  }
}

function save(): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    logger.warn('Failed to persist config.json (ephemeral FS or permissions).', { scope: 'config' });
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
      opusBitrate: clamp(Math.round(newConfig.opusBitrate), 16_000, 512_000),
      opusFec: Boolean(newConfig.opusFec),
      opusPlp: clamp(newConfig.opusPlp, 0, 1),
      maxMissedFrames: Math.max(1, Math.round(newConfig.maxMissedFrames)),
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
  // For tests only
  setPathForTest(p: string): void {
    CONFIG_PATH = p;
    cache = { ...DEFAULTS };
    load();
  },
};
