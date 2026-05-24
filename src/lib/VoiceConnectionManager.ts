import {
  type AudioPlayer,
  entersState,
  joinVoiceChannel,
  type PlayerSubscription,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { BaseGuildVoiceChannel } from 'discord.js';
import { logger, type LogContext } from '../utils/logger';
import type { PlaybackState } from './PlaybackStateMachine';

type Context = Pick<LogContext, 'requestId'>;

export class VoiceConnectionManager {
  private connection: VoiceConnection | null = null;
  private subscription: PlayerSubscription | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private connectionListeners: Array<{
    connection: VoiceConnection;
    event: VoiceConnectionStatus | 'error';
    listener: (...args: any[]) => void;
  }> = [];

  constructor(
    private readonly guildId: string,
    private readonly player: AudioPlayer,
    private readonly getState: () => PlaybackState,
    private readonly transition: (s: PlaybackState) => void,
    private readonly onFatalError: (e: Error) => void,
    private readonly onPermanentDisconnect: () => void,
  ) {}

  isReady(): boolean {
    return this.connection?.state.status === VoiceConnectionStatus.Ready;
  }

  getChannelId(): string | null {
    return this.connection?.joinConfig.channelId ?? null;
  }

  async join(channel: BaseGuildVoiceChannel, ctx?: Context): Promise<void> {
    if (
      this.connection &&
      this.connection.joinConfig.channelId === channel.id &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      if (this.connection.state.status === VoiceConnectionStatus.Ready && !this.subscription) {
        logger.info('Re-subscribing player after reconnect', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'resubscribe' });
        this.subscription = this.connection.subscribe(this.player) ?? null;
      }
      return;
    }

    if (this.connection) {
      logger.info('Leaving previous channel before joining new one', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'leave_before_join' });
      this.onPermanentDisconnect();
    }

    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.getState() === 'DESTROYED') {
        throw new Error('Manager was destroyed during join.');
      }

      if (attempt > 1) {
        logger.info(`Retrying join (attempt ${attempt}/${MAX_ATTEMPTS})`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_retry' });
        await new Promise<void>((r) => setTimeout(r, 2_000));
      } else {
        logger.info(`Attempting to join ${channel.name}`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_attempt' });
      }

      this.transition('JOINING');
      const newConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: this.guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      this.bindConnectionListener(newConnection, VoiceConnectionStatus.Destroyed, () => {
        logger.warn('Connection destroyed', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'destroyed' });
        this.cleanup(false);
      });

      this.bindConnectionListener(newConnection, 'error', (error: Error) => {
        logger.error(`Voice connection error: ${error.message}`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'connection_error' }, error);
        this.onPermanentDisconnect();
        this.onFatalError(error);
      });

      this.bindConnectionListener(newConnection, VoiceConnectionStatus.Disconnected, async () => {
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
            this.onPermanentDisconnect();
          }
        }
      });

      try {
        await entersState(newConnection, VoiceConnectionStatus.Ready, 15_000);
        this.connection = newConnection;
        this.subscription = this.connection.subscribe(this.player) ?? null;
        this.transition('READY');
        logger.info(`Joined ${channel.name} and subscribed player`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'joined' });
        this.startWatchdog();
        return;
      } catch (error) {
        lastError = error;
        logger.warn(`Join attempt ${attempt}/${MAX_ATTEMPTS} failed (stuck in ${newConnection.state.status})`, { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_attempt_failed' }, error);
        this.detachConnectionListeners(newConnection);
        if (newConnection.state.status !== VoiceConnectionStatus.Destroyed) {
          newConnection.destroy();
        }
        this.connection = null;
        const s = this.getState();
        if (s !== 'IDLE' && s !== 'DESTROYED') this.transition('IDLE');
      }
    }

    logger.error('Failed to become ready in target channel after all attempts', { guildId: this.guildId, scope: 'join', requestId: ctx?.requestId, event: 'join_failed' }, lastError);
    throw new Error('Failed to establish a stable voice connection.');
  }

  cleanup(destroyConnection = true): void {
    if (this.subscription) {
      try { this.subscription.unsubscribe(); } catch (e) {
        logger.debug('Unsubscribe failed', { guildId: this.guildId, scope: 'lifecycle', event: 'unsubscribe_fail' }, e);
      }
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
  }

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.connection) return;
      if (this.connection.state.status === VoiceConnectionStatus.Destroyed) {
        logger.warn('Watchdog detected destroyed connection, cleaning up', { guildId: this.guildId, scope: 'watchdog', event: 'destroyed_detected' });
        this.cleanup(false);
      }
    }, 60_000);
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
        } catch (e) {
          logger.debug('Failed to detach connection listener', { guildId: this.guildId, scope: 'lifecycle', event: 'listener_detach_fail' }, e);
        }
      } else {
        remaining.push(item);
      }
    }
    this.connectionListeners = remaining;
  }
}
