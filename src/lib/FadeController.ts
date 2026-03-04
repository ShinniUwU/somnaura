import type { AudioResource } from '@discordjs/voice';

export class FadeController {
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private fadeResolve: (() => void) | null = null;

  clearFade(): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.fadeResolve) {
      this.fadeResolve();
      this.fadeResolve = null;
    }
  }

  async startFade(resource: AudioResource, from: number, to: number, durationMs: number): Promise<void> {
    if (!resource.volume) return;
    this.clearFade();
    const vol = resource.volume;
    if (durationMs <= 0) {
      vol.setVolume(Math.max(0, to));
      return;
    }
    vol.setVolume(Math.max(0, from));
    const steps = Math.max(1, Math.round(durationMs / 50));
    const stepMs = durationMs / steps;
    const delta = (to - from) / steps;
    let current = from;
    await new Promise<void>((resolve) => {
      this.fadeResolve = resolve;
      this.fadeInterval = setInterval(() => {
        current += delta;
        const reached = delta >= 0 ? current >= to : current <= to;
        if (reached) {
          vol.setVolume(Math.max(0, to));
          this.clearFade();
          return;
        }
        vol.setVolume(Math.max(0, current));
      }, stepMs);
    });
  }

  async fadeOutStop(resource: AudioResource | null, stop: () => void, durationMs = 0): Promise<void> {
    if (resource?.volume) {
      const currentVol = typeof (resource.volume as any).volume === 'number'
        ? (resource.volume as any).volume
        : 1;
      await this.startFade(resource, currentVol, 0, durationMs);
    }
    stop();
  }
}
