import fs from 'fs';
import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  type AudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { BaseGuildVoiceChannel } from 'discord.js';
import type { Song } from '../types';
import { ConfigStore } from './ConfigStore';
import { SongQueue } from './SongQueue';
import { AsyncLock } from '../utils/asyncLock';
import { logger, type LogContext } from '../utils/logger';
import { PlaybackStateMachine, type PlaybackState } from './PlaybackStateMachine';
import { TimerManager } from './TimerManager';

type VoiceErrorCallback = (error: Error) => void;
type Context = Pick<LogContext, 'requestId'>;

export class GuildPlaybackManager {
  public readonly guildId: string;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer;
  private resource: AudioResource | null = null;
  private subscription: import('@discordjs/voice').PlayerSubscription | null = null;
  private currentSong: Song | null = null;
  private isLooping = false;
  private readonly onErrorCallback: VoiceErrorCallback;
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEFAULT_INACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private readonly queue = new SongQueue();
  private readonly playLock = new AsyncLock();
  private readonly joinLock = new AsyncLock();
  private readonly state = new PlaybackStateMachine();
  private readonly timers = new TimerManager();
  private connectionListeners: Array<{
    connection: VoiceConnection;
    event: VoiceConnectionStatus | 'error';
    listener: (...args: any[]) => void;
  }> = [];
  private suppressLoopOnce = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(guildId: string, onError: VoiceErrorCallback) {
    this.guildId = guildId;
    this.player = this.createPlayer();
    this.onErrorCallback = onError;
    logger.info('Playback Manager created', { guildId, scope: 'manager', event: 'manager_created' });
  }

  private bindConnectionListener(
    connection: VoiceConnection,
    event: VoiceConnectionStatus | 'error',
    listener: (...args: any[]) => void,
  ): void {
    connection.on(event as any, listener);
    this.connectionListeners.push({ connection, event, listener });
  }

  private detachConnectionListeners(connection?: VoiceConnection): void {
    const remaining: typeof this.connectionListeners = [];
    for (const item of this.connectionListeners) {
      if (!connection || item.connection === connection) {
        try {
          item.connection.off(item.event as any, item.listener);
        } catch {}
      } else {
        remaining.push(item);
      }
    }
    this.connectionListeners = remaining;
  }

  private createPlayer(): AudioPlayer {
    const { maxMissedFrames } = ConfigStore.get();
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
        maxMissedFrames,
      },
    });

    player.on(AudioPlayerStatus.Idle, (oldState) => {
      if (oldState.status !== AudioPlayerStatus.Playing) return;
      void this.handleIdle(oldState.resource);
    });

    player.on('error', (error) => {
      const songName =
        (error.resource?.metadata as Song | undefined)?.name ?? 'unknown';
      logger.error(`Audio player error: ${error.message}`, {
        guildId: this.guildId,
        scope: 'player',
        event: 'player_error',
      }, { song: songName, stack: error.stack });
      this.stop();
      this.scheduleInactivityDisconnect();
    });

    return player;
  }

  private async handleIdle(resource: AudioResource | undefined): Promise<void> {
    const previous = resource?.metadata as Song | undefined;
    this.currentSong = null;
    // Reset to READY so we can transition back to PLAYING when looping/queuing
    if (this.state.canTransition('READY')) {
      this.stateSafely('READY');
    }
    const shouldLoop = this.isLooping && Boolean(previous) && !this.suppressLoopOnce;
    if (this.suppressLoopOnce) this.suppressLoopOnce = false;
    if (shouldLoop && previous) {
      logger.info('Looping current song', { guildId: this.guildId, scope: 'idle', event: 'loop' }, { song: previous.name });
      try {
        await this.play(previous);
      } catch (e) {
        logger.error('Failed to loop song', { guildId: this.guildId, scope: 'idle', event: 'loop_error' }, e);
        this.scheduleInactivityDisconnect();
      }
      return;
    }

    const next = this.queue.dequeue();
    if (next) {
      logger.info('Dequeued next song', { guildId: this.guildId, scope: 'idle', event: 'dequeue' }, { song: next.name });
      try {
        await this.play(next);
      } catch (e) {
        logger.error('Failed to play queued song', { guildId: this.guildId, scope: 'idle', event: 'queue_play_error' }, e);
        this.scheduleInactivityDisconnect();
      }
      return;
    }

    this.scheduleInactivityDisconnect();
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

  private destroyPipeline(): void { /* no-op */ }

  public async join(channel: BaseGuildVoiceChannel, ctx?: Context): Promise<void> {
    await this.joinLock.runExclusive(async () => {
      if (
        this.connection &&
        this.connection.joinConfig.channelId === channel.id &&
        this.connection.state.status !== VoiceConnectionStatus.Destroyed
      ) {
        if (this.connection.state.status === VoiceConnectionStatus.Ready && !this.subscription) {
          logger.info('Re-subscribing player after reconnect', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'resubscribe' });
          this.subscription = this.connection.subscribe(this.player) ?? null;
        }
        this.clearInactivityDisconnect();
        return;
      }

      if (this.connection) {
        logger.info('Leaving previous channel before joining new one', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'leave_before_join' });
        this.leave(true);
      }

      logger.info(`Attempting to join ${channel.name}`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_attempt' });
      this.stateSafely('JOINING');
      const newConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: this.guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      const onDestroyed = () => {
        logger.warn('Connection destroyed', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'destroyed' });
        this.cleanup(false);
      };
      this.bindConnectionListener(newConnection, VoiceConnectionStatus.Destroyed, onDestroyed);

      const onError = (error: Error) => {
        logger.error(`Voice connection error: ${error.message}`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'connection_error' }, error);
        this.leave(true);
        this.onErrorCallback(error);
      };
      this.bindConnectionListener(newConnection, 'error', onError);

      const onDisconnected = async () => {
        logger.warn('Connection disconnected, attempting recovery', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'disconnected' });
        try {
          await Promise.race([
            entersState(newConnection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(newConnection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          logger.info('Connection recovered after disconnect', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'recovered' });
        } catch (error) {
          if (newConnection.state.status !== VoiceConnectionStatus.Destroyed) {
            logger.warn('Connection permanently lost; cleaning up', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'lost' }, error);
            this.leave(true);
          }
        }
      };
      this.bindConnectionListener(newConnection, VoiceConnectionStatus.Disconnected, onDisconnected);

      try {
        await entersState(newConnection, VoiceConnectionStatus.Ready, 15_000);
        this.connection = newConnection;
        this.subscription = this.connection.subscribe(this.player) ?? null;
        this.stateSafely('READY');
        logger.info(`Joined ${channel.name} and subscribed player`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'joined' });
        this.startWatchdog();
        this.clearInactivityDisconnect();
      } catch (error) {
        logger.error('Failed to become ready in target channel', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_failed' }, error);
        this.detachConnectionListeners(newConnection);
        if (newConnection.state.status !== VoiceConnectionStatus.Destroyed) {
          newConnection.destroy();
        }
        this.connection = null;
        this.stateSafely('IDLE');
        throw new Error('Failed to establish a stable voice connection.');
      }
    });
  }

  public async play(songToPlay: Song, ctx?: Context): Promise<string> {
    return this.playLock.runExclusive(async () => {
      if (!this.state.canTransition('PLAYING')) {
        logger.warn('Play ignored due to invalid state', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'invalid_state' }, { state: this.state.getState() });
        return 'Unable to play right now.';
      }
      if (
        !this.connection ||
        this.connection.state.status !== VoiceConnectionStatus.Ready
      ) {
        throw new Error('Not connected to a voice channel or connection not ready.');
      }
      if (!fs.existsSync(songToPlay.path)) {
        const message = `Song file not found at path: ${songToPlay.path}`;
        logger.error(message, { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'missing_file' });
        throw new Error(`Could not find the file for "${songToPlay.name}".`);
      }

      logger.info('Starting playback', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId, event: 'play_start' }, { song: songToPlay.name });
      this.clearInactivityDisconnect();
      const { microFadeMs, opusBitrate, opusFec, opusPlp } = ConfigStore.get();

      try {
        const resource: AudioResource = createAudioResource(songToPlay.path, {
          metadata: songToPlay,
          inlineVolume: true,
        });
        if (resource.encoder) {
          try { resource.encoder.setBitrate(opusBitrate); } catch (e) { logger.debug('setBitrate failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
          try { resource.encoder.setFEC(Boolean(opusFec)); } catch (e) { logger.debug('setFEC failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
          try { resource.encoder.setPLP(Math.max(0, Math.min(1, opusPlp))); } catch (e) { logger.debug('setPLP failed', { guildId: this.guildId, scope: 'play', requestId: ctx?.requestId }, e); }
        }
        if (resource.volume) {
          resource.volume.setVolume(Math.max(0, microFadeMs > 0 ? 0 : 1));
        }
        this.player.play(resource);
        this.resource = resource;
        this.currentSong = songToPlay;
        this.stateSafely('PLAYING');
        if (resource.volume && microFadeMs > 0) {
          await this.startFade(0, 1, microFadeMs);
        }
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
      this.clearFade();
      // Prevent handleIdle (which fires synchronously inside player.stop) from
      // restarting the song via the loop path on an explicit stop call.
      this.suppressLoopOnce = true;
      this.player.stop(true);
      this.resource = null;
      this.currentSong = null;
      this.destroyPipeline();
      this.scheduleInactivityDisconnect();
      // handleIdle fires synchronously during player.stop() and already transitions
      // to READY when old state was Playing. Only call here for the Paused case
      // (oldState=Paused → handleIdle is skipped → state is still PLAYING).
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

  public leave(silent = false, ctx?: Context): void {
    logger.info('Leave requested', { guildId: this.guildId, scope: 'lifecycle', requestId: ctx?.requestId, event: 'leave' });
    this.cleanup();
    if (!silent) {
      logger.info('Left voice channel', { guildId: this.guildId, scope: 'lifecycle', requestId: ctx?.requestId, event: 'left' });
    }
  }

  public enqueue(song: Song): string {
    return this.queue.enqueue(song);
  }

  public getQueue(): Song[] { return this.queue.list(); }
  public clearQueue(): void { this.queue.clear(); }

  public async skip(fadeMs = 250, ctx?: Context): Promise<string> {
    return this.playLock.runExclusive(async () => {
      if (!this.currentSong) {
        logger.warn('Skip ignored: no track playing', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'skip_ignored' });
        return 'Nothing is playing.';
      }
      const queuedNextName = this.queue.list()[0]?.name;
      // Ensure explicit skip does not instantly re-loop the same track.
      this.suppressLoopOnce = true;
      try {
        await this.fadeOutStop(fadeMs);
      } catch (e) {
        logger.warn('Fade-out during skip failed, forcing stop', { guildId: this.guildId, scope: 'control', requestId: ctx?.requestId, event: 'skip_fade_fail' }, e);
        this.stop(ctx);
      }
      if (queuedNextName) return `Skipped. Next up: ${queuedNextName}`;
      return 'Skipped. Queue is empty.';
    });
  }

  public toggleLoop(): string {
    this.isLooping = !this.isLooping;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong
      ? ` for **${this.currentSong.name}**`
      : '';
    logger.info(`Looping ${status}`, { guildId: this.guildId, scope: 'control', event: 'loop_toggle' });
    return `Looping ${status}${songName}.`;
  }

  public getStatus(): string {
    if (
      this.player.state.status === AudioPlayerStatus.Playing &&
      this.currentSong
    ) {
      return `Now Playing: **${this.currentSong.name}** ${
        this.isLooping ? '(Looping)' : ''
      }`;
    }
    if (
      this.player.state.status === AudioPlayerStatus.Paused &&
      this.currentSong
    ) {
      return `Paused: **${this.currentSong.name}** ${
        this.isLooping ? '(Looping)' : ''
      }`;
    }
    if (
      this.player.state.status === AudioPlayerStatus.Buffering &&
      this.currentSong
    ) {
      return `Buffering: **${this.currentSong.name}** ${
        this.isLooping ? '(Looping)' : ''
      }`;
    }
    return 'Nothing currently playing.';
  }

  public getCurrentSong(): Song | null {
    return this.currentSong;
  }

  public getChannelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  public scheduleAloneDisconnect(): void {
    const { autoLeaveAlone, aloneGraceSeconds } = ConfigStore.get();
    if (!autoLeaveAlone) return;
    if (this.aloneTimer) return;
    const ms = Math.max(5, aloneGraceSeconds) * 1000;
    this.aloneTimer = this.timers.setTimeout(() => {
      logger.info('Auto-leaving because alone in channel', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave' });
      this.aloneTimer = null;
      void (async () => {
        try {
          await this.fadeOutStop(1000);
        } catch (e) {
          logger.warn('Auto-leave fade failed, forcing stop', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_fade_fail' }, e);
          this.stop();
        } finally {
          this.leave(true);
        }
      })();
    }, ms);
    logger.info(`Scheduled auto-leave when alone`, { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_schedule' }, { delayMs: ms });
  }

  public cancelAloneDisconnect(): void {
    if (this.aloneTimer) {
      this.timers.clear(this.aloneTimer);
      this.aloneTimer = null;
      logger.info('Cancelled auto-leave (not alone)', { guildId: this.guildId, scope: 'lifecycle', event: 'auto_leave_cancel' });
    }
  }

  private cleanup(destroyConnection = true): void {
    logger.info('Cleaning up resources', { guildId: this.guildId, scope: 'lifecycle', event: 'cleanup' }, { destroyConnection });
    this.clearFade();
    this.clearInactivityDisconnect();
    this.timers.clearAll();
    if (this.player) {
      this.player.stop(true);
    }
    this.destroyPipeline();
    if (this.subscription) {
      try { this.subscription.unsubscribe(); } catch (e) { logger.debug('Unsubscribe failed', { guildId: this.guildId, scope: 'lifecycle', event: 'unsubscribe_fail' }, e); }
      this.subscription = null;
    }
    this.detachConnectionListeners();
    if (destroyConnection && this.connection) {
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection.destroy();
      }
      this.connection = null;
    }
    if (this.connection?.state.status === VoiceConnectionStatus.Destroyed) {
      this.connection = null;
    }
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }

    this.currentSong = null;
    const currentState = this.state.getState();
    if (currentState !== 'DESTROYED' && currentState !== 'IDLE') this.stateSafely('IDLE');
  }

  public destroy(): void {
    logger.info('Destroying playback manager', { guildId: this.guildId, scope: 'lifecycle', event: 'destroy' });
    this.cleanup(true);
    this.isLooping = false;
    this.stateSafely('DESTROYED');
  }

  public applyConfig(): void {
    const { maxMissedFrames } = ConfigStore.get();
    try {
      // @ts-ignore accessing behaviors directly
      this.player.behaviors.maxMissedFrames = maxMissedFrames;
      logger.info('Updated maxMissedFrames', { guildId: this.guildId, scope: 'config', event: 'config_update' }, { maxMissedFrames });
    } catch (e) {
      logger.warn('Failed to update maxMissedFrames on player', { guildId: this.guildId, scope: 'config', event: 'config_update_fail' }, e);
    }
  }

  public isLoopEnabled(): boolean {
    return this.isLooping;
  }

  public setLoop(enabled: boolean): string {
    this.isLooping = enabled;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong ? ` for **${this.currentSong.name}**` : '';
    logger.info(`Looping set to ${status}`, { guildId: this.guildId, scope: 'control', event: 'loop_set' });
    return `Looping ${status}${songName}.`;
  }

  public setVolume(_vol: number): string { return 'Volume control disabled.'; }

  private fadeResolve: (() => void) | null = null;

  private clearFade(): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.fadeResolve) {
      this.fadeResolve();
      this.fadeResolve = null;
    }
  }

  private async startFade(from: number, to: number, durationMs: number): Promise<void> {
    if (!this.resource || !this.resource.volume) return;
    this.clearFade();
    const vol = this.resource.volume;
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

  public async fadeOutStop(durationMs = 0): Promise<void> {
    if (this.resource?.volume) {
      const currentVol =
        typeof (this.resource.volume as any).volume === 'number'
          ? (this.resource.volume as any).volume
          : 1;
      await this.startFade(currentVol, 0, durationMs);
    }
    this.stop();
  }

  public startSleepTimer(durationMs: number, fadeOutMs = 2000): string {
    if (this.sleepTimeout) {
      this.timers.clear(this.sleepTimeout);
      this.sleepTimeout = null;
    }
    this.sleepTimeout = this.timers.setTimeout(() => {
      this.sleepTimeout = null;
      void (async () => {
        try {
          await this.fadeOutStop(fadeOutMs);
        } catch (e) {
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

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.connection) return;
      const status = this.connection.state.status;
      if (status === VoiceConnectionStatus.Destroyed) {
        logger.warn('Watchdog detected destroyed connection, cleaning up', { guildId: this.guildId, scope: 'watchdog', event: 'destroyed_detected' });
        this.cleanup(false);
      }
    }, 60_000);
  }

  private stateSafely(next: PlaybackState): void {
    try {
      if (this.state.getState() !== 'DESTROYED') {
        this.state.transition(next);
      }
    } catch (e) {
      logger.warn(`Invalid state transition`, { guildId: this.guildId, scope: 'state', event: 'invalid_transition' }, { from: this.state.getState(), to: next, error: (e as Error).message });
    }
  }
}
