import fs from 'fs';
import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  type AudioResource,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import type { BaseGuildVoiceChannel } from 'discord.js';
import type { Song } from '../types';
import { ConfigStore } from './ConfigStore';
import { SongQueue } from './SongQueue';
import { AsyncLock } from '../utils/asyncLock';
import { logger, type LogContext } from '../utils/logger';
import { PlaybackStateMachine, type PlaybackState } from './PlaybackStateMachine';
import { TimerManager } from './TimerManager';
import { FadeController } from './FadeController';
import { VoiceConnectionManager } from './VoiceConnectionManager';

type VoiceErrorCallback = (error: Error) => void;
type Context = Pick<LogContext, 'requestId'>;

export class GuildPlaybackManager {
  public readonly guildId: string;
  private player: AudioPlayer;
  private resource: AudioResource | null = null;
  private currentSong: Song | null = null;
  private isLooping = false;
  private suppressLoopOnce = false;
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEFAULT_INACTIVITY_TIMEOUT_MS = 300_000;
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly queue = new SongQueue();
  private readonly playLock = new AsyncLock();
  private readonly joinLock = new AsyncLock();
  private readonly state = new PlaybackStateMachine();
  private readonly timers = new TimerManager();
  private readonly fader = new FadeController();
  private readonly voice: VoiceConnectionManager;

  constructor(guildId: string, onError: VoiceErrorCallback) {
    this.guildId = guildId;
    this.player = this.createPlayer();
    this.voice = new VoiceConnectionManager(
      guildId,
      this.player,
      () => this.state.getState(),
      (s) => this.stateSafely(s),
      onError,
      () => this.leave(true),
    );
    logger.info('Playback Manager created', { guildId, scope: 'manager', event: 'manager_created' });
  }

  // ── Player ──────────────────────────────────────────────────────────────

  private createPlayer(): AudioPlayer {
    const { maxMissedFrames } = ConfigStore.get();
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause, maxMissedFrames },
    });

    player.on(AudioPlayerStatus.Idle, (oldState) => {
      if (oldState.status !== AudioPlayerStatus.Playing) return;
      void this.handleIdle(oldState.resource);
    });

    player.on('error', (error) => {
      const songName = (error.resource?.metadata as Song | undefined)?.name ?? 'unknown';
      logger.error(`Audio player error: ${error.message}`, { guildId: this.guildId, scope: 'player', event: 'player_error' }, { song: songName, stack: error.stack });
      this.stop();
      this.scheduleInactivityDisconnect();
    });

    return player;
  }

  private async handleIdle(resource: AudioResource | undefined): Promise<void> {
    const previous = resource?.metadata as Song | undefined;
    this.currentSong = null;
    if (this.state.canTransition('READY')) this.stateSafely('READY');

    const shouldLoop = this.isLooping && Boolean(previous) && !this.suppressLoopOnce;
    if (this.suppressLoopOnce) this.suppressLoopOnce = false;

    if (shouldLoop && previous) {
      logger.info('Looping current song', { guildId: this.guildId, scope: 'idle', event: 'loop' }, { song: previous.name });
      try { await this.play(previous); } catch (e) {
        logger.error('Failed to loop song', { guildId: this.guildId, scope: 'idle', event: 'loop_error' }, e);
        this.scheduleInactivityDisconnect();
      }
      return;
    }

    const next = this.queue.dequeue();
    if (next) {
      logger.info('Dequeued next song', { guildId: this.guildId, scope: 'idle', event: 'dequeue' }, { song: next.name });
      try { await this.play(next); } catch (e) {
        logger.error('Failed to play queued song', { guildId: this.guildId, scope: 'idle', event: 'queue_play_error' }, e);
        this.scheduleInactivityDisconnect();
      }
      return;
    }

    this.scheduleInactivityDisconnect();
  }

  // ── Playback controls ───────────────────────────────────────────────────

  public async join(channel: BaseGuildVoiceChannel, ctx?: Context): Promise<void> {
    await this.joinLock.runExclusive(async () => {
      this.clearInactivityDisconnect();
      await this.voice.join(channel, ctx);
      this.clearInactivityDisconnect();
    });
  }

  public async play(songToPlay: Song, ctx?: Context): Promise<string> {
    return this.playLock.runExclusive(async () => {
      if (!this.state.canTransition('PLAYING')) {
        logger.warn('Play ignored due to invalid state', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'invalid_state' }, { state: this.state.getState() });
        return 'Unable to play right now.';
      }
      if (!this.voice.isReady()) {
        throw new Error('Not connected to a voice channel or connection not ready.');
      }
      if (!fs.existsSync(songToPlay.path)) {
        logger.error(`Song file not found: ${songToPlay.path}`, { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'missing_file' });
        throw new Error(`Could not find the file for "${songToPlay.name}".`);
      }

      logger.info('Starting playback', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'play_start' }, { song: songToPlay.name });
      this.clearInactivityDisconnect();
      const { microFadeMs, opusBitrate, opusFec, opusPlp } = ConfigStore.get();

      try {
        const resource = createAudioResource(songToPlay.path, { metadata: songToPlay, inlineVolume: true });
        if (resource.encoder) {
          try { resource.encoder.setBitrate(opusBitrate); } catch (e) { logger.debug('setBitrate failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
          try { resource.encoder.setFEC(Boolean(opusFec)); } catch (e) { logger.debug('setFEC failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
          try { resource.encoder.setPLP(Math.max(0, Math.min(1, opusPlp))); } catch (e) { logger.debug('setPLP failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
        }
        if (resource.volume) resource.volume.setVolume(Math.max(0, microFadeMs > 0 ? 0 : 1));
        this.player.play(resource);
        this.resource = resource;
        this.currentSong = songToPlay;
        this.stateSafely('PLAYING');
        if (resource.volume && microFadeMs > 0) await this.fader.startFade(resource, 0, 1, microFadeMs);
        return `Now playing: **${songToPlay.name}**`;
      } catch (error) {
        logger.error('Error creating resource or playing', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'play_error' }, error);
        this.currentSong = null;
        this.stateSafely('READY');
        this.scheduleInactivityDisconnect();
        throw new Error(`Failed to play "${songToPlay.name}". File might be corrupted or unsupported.`);
      }
    });
  }

  public stop(ctx?: Context): void {
    if (this.player.state.status !== AudioPlayerStatus.Idle) {
      logger.info('Stopping playback', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'stop' });
      this.fader.clearFade();
      this.suppressLoopOnce = true;
      this.player.stop(true);
      this.resource = null;
      this.currentSong = null;
      this.scheduleInactivityDisconnect();
      if (this.state.canTransition('READY')) this.stateSafely('READY');
    } else {
      logger.debug('Stop requested but player already idle', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'stop_ignored' });
    }
  }

  public pause(ctx?: Context): boolean {
    const ok = this.player.pause(true);
    if (ok) {
      logger.info('Paused playback', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'pause' });
      this.scheduleInactivityDisconnect();
    }
    return ok;
  }

  public resume(ctx?: Context): boolean {
    const ok = this.player.unpause();
    if (ok) {
      logger.info('Resumed playback', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'resume' });
      this.clearInactivityDisconnect();
    }
    return ok;
  }

  public async skip(fadeMs = 250, ctx?: Context): Promise<string> {
    return this.playLock.runExclusive(async () => {
      if (!this.currentSong) {
        logger.warn('Skip ignored: no track playing', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'skip_ignored' });
        return 'Nothing is playing.';
      }
      const queuedNextName = this.queue.list()[0]?.name;
      this.suppressLoopOnce = true;
      try {
        await this.fadeOutStop(fadeMs);
      } catch (e) {
        logger.warn('Fade-out during skip failed, forcing stop', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'skip_fade_fail' }, e);
        this.stop(ctx);
      }
      return queuedNextName ? `Skipped. Next up: ${queuedNextName}` : 'Skipped. Queue is empty.';
    });
  }

  public async fadeOutStop(durationMs = 0): Promise<void> {
    await this.fader.fadeOutStop(this.resource, () => this.stop(), durationMs);
  }

  // ── Queue ───────────────────────────────────────────────────────────────

  public enqueue(song: Song): string { return this.queue.enqueue(song); }
  public getQueue(): Song[] { return this.queue.list(); }
  public clearQueue(): void { this.queue.clear(); }

  // ── Loop ────────────────────────────────────────────────────────────────

  public toggleLoop(): string {
    this.isLooping = !this.isLooping;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong ? ` for **${this.currentSong.name}**` : '';
    logger.info(`Looping ${status}`, { guildId: this.guildId, scope: 'control', event: 'loop_toggle' });
    return `Looping ${status}${songName}.`;
  }

  public isLoopEnabled(): boolean { return this.isLooping; }

  public setLoop(enabled: boolean): string {
    this.isLooping = enabled;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong ? ` for **${this.currentSong.name}**` : '';
    logger.info(`Looping set to ${status}`, { guildId: this.guildId, scope: 'control', event: 'loop_set' });
    return `Looping ${status}${songName}.`;
  }

  // ── Timers ──────────────────────────────────────────────────────────────

  public startSleepTimer(durationMs: number, fadeOutMs = 2000): string {
    if (this.sleepTimeout) {
      this.timers.clear(this.sleepTimeout);
      this.sleepTimeout = null;
    }
    this.sleepTimeout = this.timers.setTimeout(() => {
      this.sleepTimeout = null;
      void (async () => {
        try { await this.fadeOutStop(fadeOutMs); } catch (e) {
          logger.warn('Sleep timer fade failed, forcing stop', { guildId: this.guildId, scope: 'sleep', event: 'sleep_fade_fail' }, e);
          this.stop();
        } finally {
          this.leave(true);
        }
      })();
    }, durationMs);
    return `Sleep timer set for ${(durationMs / 60000).toFixed(1)} minutes.`;
  }

  public cancelSleepTimer(): string {
    if (this.sleepTimeout) {
      this.timers.clear(this.sleepTimeout);
      this.sleepTimeout = null;
      return 'Sleep timer cancelled.';
    }
    return 'No sleep timer was set.';
  }

  public scheduleAloneDisconnect(): void {
    const { autoLeaveAlone, aloneGraceSeconds } = ConfigStore.get();
    if (!autoLeaveAlone || this.aloneTimer) return;
    const ms = Math.max(5, aloneGraceSeconds) * 1000;
    this.aloneTimer = this.timers.setTimeout(() => {
      this.aloneTimer = null;
      void (async () => {
        logger.info('Auto-leaving because alone in channel', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave' });
        try { await this.fadeOutStop(1000); } catch (e) {
          logger.warn('Auto-leave fade failed, forcing stop', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_fade_fail' }, e);
          this.stop();
        } finally {
          this.leave(true);
        }
      })();
    }, ms);
    logger.info('Scheduled auto-leave when alone', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_schedule' }, { delayMs: ms });
  }

  public cancelAloneDisconnect(): void {
    if (this.aloneTimer) {
      this.timers.clear(this.aloneTimer);
      this.aloneTimer = null;
      logger.info('Cancelled auto-leave (not alone)', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_cancel' });
    }
  }

  private scheduleInactivityDisconnect(): void {
    this.clearInactivityDisconnect();
    const mins = ConfigStore.get().inactivityMinutes;
    if (mins <= 0) return;
    const ms = Math.round(mins * 60_000) || GuildPlaybackManager.DEFAULT_INACTIVITY_TIMEOUT_MS;
    logger.info('Scheduling inactivity disconnect', { guildId: this.guildId, scope: 'lifecycle', event: 'inactivity_schedule' }, { delayMs: ms });
    this.inactivityTimeout = this.timers.setTimeout(() => {
      logger.info('Disconnecting due to inactivity', { guildId: this.guildId, scope: 'lifecycle', event: 'inactivity_leave' });
      this.leave();
    }, ms);
  }

  private clearInactivityDisconnect(): void {
    if (this.inactivityTimeout) {
      this.timers.clear(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  public leave(silent = false, ctx?: Context): void {
    logger.info('Leave requested', { guildId: this.guildId, scope: 'lifecycle', requestId: ctx?.requestId, event: 'leave' });
    this.cleanup();
    if (!silent) {
      logger.info('Left voice channel', { guildId: this.guildId, scope: 'lifecycle', requestId: ctx?.requestId, event: 'left' });
    }
  }

  private cleanup(destroyConnection = true): void {
    logger.info('Cleaning up resources', { guildId: this.guildId, scope: 'lifecycle', event: 'cleanup' }, { destroyConnection });
    this.fader.clearFade();
    this.clearInactivityDisconnect();
    this.timers.clearAll();
    this.player.stop(true);
    this.voice.cleanup(destroyConnection);
    this.currentSong = null;
    const s = this.state.getState();
    if (s !== 'DESTROYED' && s !== 'IDLE') this.stateSafely('IDLE');
  }

  public destroy(): void {
    logger.info('Destroying playback manager', { guildId: this.guildId, scope: 'lifecycle', event: 'destroy' });
    this.cleanup(true);
    this.isLooping = false;
    this.stateSafely('DESTROYED');
  }

  // ── Status / info ───────────────────────────────────────────────────────

  public getStatus(): string {
    const song = this.currentSong;
    const loop = this.isLooping ? ' (Looping)' : '';
    const status = this.player.state.status;
    if (status === AudioPlayerStatus.Playing && song) return `Now Playing: **${song.name}**${loop}`;
    if (status === AudioPlayerStatus.Paused && song) return `Paused: **${song.name}**${loop}`;
    if (status === AudioPlayerStatus.Buffering && song) return `Buffering: **${song.name}**${loop}`;
    return 'Nothing currently playing.';
  }

  public getCurrentSong(): Song | null { return this.currentSong; }
  public getChannelId(): string | null { return this.voice.getChannelId(); }
  public setVolume(_vol: number): string { return 'Volume control disabled.'; }

  public applyConfig(): void {
    const { maxMissedFrames } = ConfigStore.get();
    try {
      // @ts-ignore
      this.player.behaviors.maxMissedFrames = maxMissedFrames;
      logger.info('Updated maxMissedFrames', { guildId: this.guildId, scope: 'config', event: 'config_update' }, { maxMissedFrames });
    } catch (e) {
      logger.warn('Failed to update maxMissedFrames on player', { guildId: this.guildId, scope: 'config', event: 'config_update_fail' }, e);
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private stateSafely(next: PlaybackState): void {
    try {
      if (this.state.getState() !== 'DESTROYED') this.state.transition(next);
    } catch (e) {
      logger.warn('Invalid state transition', { guildId: this.guildId, scope: 'state', event: 'invalid_transition' }, { from: this.state.getState(), to: next, error: (e as Error).message });
    }
  }
}
