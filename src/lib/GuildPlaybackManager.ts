import fs from 'fs'; // <-- Added missing import
import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  type AudioResource,
  entersState, // <-- Added explicit import
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { BaseGuildVoiceChannel } from 'discord.js'; // Use type import
import type { Song } from '../types'; // Use type import
import { ConfigStore } from './ConfigStore';

type VoiceErrorCallback = (error: Error) => void;

export class GuildPlaybackManager {
  public readonly guildId: string;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer;
  private resource: AudioResource | null = null;
  private subscription: import('@discordjs/voice').PlayerSubscription | null = null;
  private currentSong: Song | null = null;
  private isLooping: boolean = false;
  private onErrorCallback: VoiceErrorCallback;
  // No custom pipeline retained
  // Use ReturnType<...> for better type safety with setTimeout
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null; // <-- Changed type
  private static readonly DEFAULT_INACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Song[] = [];

  // No fade timers

  constructor(guildId: string, onError: VoiceErrorCallback) {
    this.guildId = guildId;
    this.player = this.createPlayer();
    this.onErrorCallback = onError;
    console.log(`[Guild ${guildId}] Playback Manager created.`);
  }

  // No custom pipeline; rely on library resource builder for stability

  private createPlayer(): AudioPlayer {
    const { maxMissedFrames } = ConfigStore.get();
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
        maxMissedFrames,
      },
    });

    player.on(AudioPlayerStatus.Idle, (oldState) => {
      if (oldState.status === AudioPlayerStatus.Playing) {
        console.log(`[Guild ${this.guildId}] Player Idle.`);
        const previousSong = this.currentSong; // Store before clearing
        this.currentSong = null;
        if (this.isLooping && oldState.resource.metadata) {
          // Use the song data attached to the resource metadata when it was created
          const loopedSong = oldState.resource.metadata as Song;
          // Double-check if it's the same song in case state changed rapidly
          if (previousSong?.path === loopedSong.path) {
            console.log(`[Guild ${this.guildId}] Looping: ${loopedSong.name}`);
            this.play(loopedSong).catch((e) =>
              console.error(`[Guild ${this.guildId}] Error self-looping:`, e),
            ); // Re-play the same song
          } else {
            console.log(
              `[Guild ${this.guildId}] Loop was enabled but song changed before looping.`,
            );
            this.scheduleInactivityDisconnect();
          }
        } else if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          this.play(next).catch((e) => {
            console.error(`[Guild ${this.guildId}] Failed to play queued song:`, e);
            this.scheduleInactivityDisconnect();
          });
        } else {
          this.scheduleInactivityDisconnect();
        }
      }
    });

    player.on('error', (error) => {
      console.error(
        `[Guild ${this.guildId}] Audio Player Error: ${error.message}`,
        error,
      );
      if (error.resource && error.resource.metadata) {
        const erroredSong = error.resource.metadata as Song;
        console.error(
          `[Guild ${this.guildId}] Error occurred during playback of: ${erroredSong.name}`,
        );
      }
      this.stop(); // Stop playback
      this.scheduleInactivityDisconnect();
    });

    return player;
  }

  // Volume removed

  private scheduleInactivityDisconnect(): void {
    this.clearInactivityDisconnect();
    console.log(`[Guild ${this.guildId}] Scheduling inactivity disconnect.`);
    const mins = ConfigStore.get().inactivityMinutes;
    if (mins <= 0) return; // disabled
    const ms = Math.round(mins * 60_000);
    this.inactivityTimeout = setTimeout(() => {
      console.log(`[Guild ${this.guildId}] Disconnecting due to inactivity.`);
      this.leave();
    }, ms || GuildPlaybackManager.DEFAULT_INACTIVITY_TIMEOUT_MS);
  }

  private clearInactivityDisconnect(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
      // console.log(`[Guild ${this.guildId}] Cleared inactivity disconnect timer.`); // Can be noisy
    }
  }

  private destroyPipeline(): void { /* no-op */ }

  public async join(channel: BaseGuildVoiceChannel): Promise<void> {
    if (
      this.connection &&
      this.connection.joinConfig.channelId === channel.id &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      // console.log(`[Guild ${this.guildId}] Already connected to ${channel.name}`); // Can be noisy
      if (this.connection.state.status === VoiceConnectionStatus.Ready && !this.subscription) {
        console.log(`[Guild ${this.guildId}] Re-subscribing player.`);
        this.subscription = this.connection.subscribe(this.player) ?? null;
      }
      this.clearInactivityDisconnect();
      return;
    }

    if (this.connection) {
      console.log(
        `[Guild ${this.guildId}] Leaving previous channel before joining ${channel.name}`,
      );
      this.leave(true);
    }

    console.log(`[Guild ${this.guildId}] Attempting to join ${channel.name}`);
    const newConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true, // Good practice to self-deafen
    });

    newConnection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`[Guild ${this.guildId}] Connection Destroyed.`);
      this.cleanup(false); // Cleanup state but don't try to destroy connection again
    });

    newConnection.on('error', (error) => {
      console.error(
        `[Guild ${this.guildId}] Voice Connection Error: ${error.message}`,
      );
      this.leave(true);
      this.onErrorCallback(error);
    });

    newConnection.on(
      VoiceConnectionStatus.Disconnected,
      async (oldState, newState) => {
        console.warn(`[Guild ${this.guildId}] Connection Disconnected.`);
        try {
          await Promise.race([
            entersState(newConnection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(newConnection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          console.log(`[Guild ${this.guildId}] Connection recovered.`);
        } catch (error) {
          // Don't destroy connection if it's already destroyed (e.g., during graceful shutdown)
          if (newConnection.state.status !== VoiceConnectionStatus.Destroyed) {
            console.log(
              `[Guild ${this.guildId}] Connection permanently lost, cleaning up.`,
            );
            this.leave(true); // Attempt cleanup
          }
        }
      },
    );

    try {
      // Wait for the connection to be ready
      await entersState(newConnection, VoiceConnectionStatus.Ready, 15_000);
      this.connection = newConnection;
      this.subscription = this.connection.subscribe(this.player) ?? null;
      console.log(
        `[Guild ${this.guildId}] Successfully joined ${channel.name} and subscribed player.`,
      );
      this.clearInactivityDisconnect();
    } catch (error) {
      console.error(
        `[Guild ${this.guildId}] Failed to join or become ready in ${channel.name}:`,
        error,
      );
      // Check status before destroying
      if (newConnection.state.status !== VoiceConnectionStatus.Destroyed) {
        newConnection.destroy();
      }
      this.connection = null;
      throw new Error('Failed to establish a stable voice connection.');
    }
  }

  // Note: Renamed parameter for clarity
  public async play(songToPlay: Song): Promise<string> {
    if (
      !this.connection ||
      this.connection.state.status !== VoiceConnectionStatus.Ready
    ) {
      throw new Error(
        'Not connected to a voice channel or connection not ready.',
      );
    }
    if (!fs.existsSync(songToPlay.path)) {
      console.error(
        `[Guild ${this.guildId}] Error: Song file not found at path: ${songToPlay.path}`,
      );
      // Reload songs in case file was added after startup?
      // reloadSongs(); // Assuming reloadSongs is imported from utils
      throw new Error(`Could not find the file for "${songToPlay.name}".`);
    }

    console.log(`[Guild ${this.guildId}] Playing ${songToPlay.name}`);
    this.clearInactivityDisconnect();
    try {
      // Build resource using library defaults for compatibility and stability
      const resource: AudioResource = createAudioResource(songToPlay.path, {
        metadata: songToPlay,
        inlineVolume: false,
      });
      // Apply encoder tuning when available
      if (resource.encoder) {
        const { opusBitrate, opusFec, opusPlp } = ConfigStore.get();
        try { resource.encoder.setBitrate(opusBitrate); } catch {}
        try { resource.encoder.setFEC(Boolean(opusFec)); } catch {}
        try { resource.encoder.setPLP(Math.max(0, Math.min(1, opusPlp))); } catch {}
      }
      this.player.play(resource);
      this.resource = resource;
      this.currentSong = songToPlay;
      return `Now playing: **${songToPlay.name}**`;
    } catch (playError) {
      console.error(`[Guild ${this.guildId}] Tuned pipeline failed, falling back:`, playError);
      // Fallback to library defaults if our tuned pipeline errors
      try {
        const resource = createAudioResource(songToPlay.path, { metadata: songToPlay, inlineVolume: false });
        // If prism chose an internal Opus encoder, apply options when possible
        // Note: When FFmpeg(libopus) path is selected internally, encoder may be undefined
        if (resource.encoder) {
          const { opusBitrate, opusFec, opusPlp } = ConfigStore.get();
          try { resource.encoder.setBitrate(opusBitrate); } catch {}
          try { resource.encoder.setFEC(Boolean(opusFec)); } catch {}
          try { resource.encoder.setPLP(opusPlp); } catch {}
        }
        this.player.play(resource);
        this.resource = resource;
        this.currentSong = songToPlay;
        return `Now playing: **${songToPlay.name}**`;
      } catch (fallbackError) {
        console.error(
          `[Guild ${this.guildId}] Error creating resource or playing (Path: ${songToPlay.path}):`,
          fallbackError,
        );
        this.currentSong = null;
        this.scheduleInactivityDisconnect();
        throw new Error(
          `Failed to play "${songToPlay.name}". File might be corrupted or unsupported.`,
        );
      }
    }
  }

  public stop(): void {
    if (this.player.state.status !== AudioPlayerStatus.Idle) {
      console.log(`[Guild ${this.guildId}] Stopping playback.`);
      this.player.stop(true);
      this.resource = null;
      this.currentSong = null; // Clear current song when stopped
      // Make sure to tear down any custom pipeline
      this.destroyPipeline();
      // Note: We keep the loop state as is. User might want it on for the next song.
      this.scheduleInactivityDisconnect();
    } else {
      console.log(
        `[Guild ${this.guildId}] Stop requested but player already idle.`,
      );
    }
  }

  public pause(): boolean {
    const ok = this.player.pause(true);
    if (ok) this.scheduleInactivityDisconnect();
    return ok;
  }

  public resume(): boolean {
    const ok = this.player.unpause();
    if (ok) this.clearInactivityDisconnect();
    return ok;
  }

  public leave(silent = false): void {
    console.log(`[Guild ${this.guildId}] Leave requested.`);
    this.cleanup(); // Call full cleanup
    if (!silent) {
      console.log(`[Guild ${this.guildId}] Left voice channel.`);
    }
  }

  // Queue controls
  public enqueue(song: Song): string {
    this.queue.push(song);
    return `Queued: ${song.name} (${this.queue.length} in queue)`;
  }

  public getQueue(): Song[] { return [...this.queue]; }
  public clearQueue(): void { this.queue = []; }

  public async skip(fadeMs = 250): Promise<string> {
    if (!this.currentSong) {
      return 'Nothing is playing.';
    }
    try {
      await this.fadeOutStop(fadeMs);
    } catch {
      this.stop();
    }
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      await this.play(next);
      return `Skipped. Now playing: ${next.name}`;
    }
    return 'Skipped. Queue is empty.';
  }

  public toggleLoop(): string {
    // Allow toggling loop even if paused or idle, applies to next song if current is null
    // if (!this.currentSong || this.player.state.status === AudioPlayerStatus.Idle) {
    //    return 'No song is currently playing or ready to be looped.';
    // }
    this.isLooping = !this.isLooping;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong
      ? ` for **${this.currentSong.name}**`
      : '';
    console.log(`[Guild ${this.guildId}] Looping set to ${this.isLooping}`);
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
    if (this.aloneTimer) return; // already scheduled
    const ms = Math.max(5, aloneGraceSeconds) * 1000;
    this.aloneTimer = setTimeout(() => {
      this.fadeOutStop(1000).catch(() => this.stop());
      this.leave(true);
      this.aloneTimer = null;
    }, ms);
    console.log(`[Guild ${this.guildId}] Scheduled auto-leave in ${ms}ms (alone).`);
  }

  public cancelAloneDisconnect(): void {
    if (this.aloneTimer) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
      console.log(`[Guild ${this.guildId}] Cancelled auto-leave (not alone).`);
    }
  }

  // Internal cleanup method
  private cleanup(destroyConnection = true): void {
    console.log(
      `[Guild ${this.guildId}] Cleaning up resources (destroyConnection: ${destroyConnection})...`,
    );
    this.clearInactivityDisconnect();
    if (this.player) {
      this.player.stop(true);
    }
    // Always dispose of any custom streams
    this.destroyPipeline();
    if (this.subscription) {
      try { this.subscription.unsubscribe(); } catch {}
      this.subscription = null;
    }
    if (destroyConnection && this.connection) {
      // Check status before destroying
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection.destroy();
      }
      this.connection = null; // Clear reference
    }

    this.currentSong = null;
    // Keep player instance reusable unless destroying the whole manager
  }

  public destroy(): void {
    console.log(`[Guild ${this.guildId}] Destroying Playback Manager.`);
    this.cleanup(true); // Ensure connection is destroyed
    this.isLooping = false; // Reset on full destroy
    // Player has no explicit destroy, rely on garbage collection
  }

  // Apply updated config to running player
  public applyConfig(): void {
    const { maxMissedFrames } = ConfigStore.get();
    try {
      // Adjust tolerance without rebuilding the player
      // @ts-ignore accessing behaviors directly
      this.player.behaviors.maxMissedFrames = maxMissedFrames;
    } catch {}
  }

  public isLoopEnabled(): boolean {
    return this.isLooping;
  }

  public setLoop(enabled: boolean): string {
    this.isLooping = enabled;
    const status = this.isLooping ? 'enabled' : 'disabled';
    const songName = this.currentSong ? ` for **${this.currentSong.name}**` : '';
    console.log(`[Guild ${this.guildId}] Looping set to ${this.isLooping}`);
    return `Looping ${status}${songName}.`;
  }

  public setVolume(_vol: number): string { return 'Volume control disabled.'; }

  private startFade(_from: number, _to: number, _durationMs: number): void { /* no-op */ }

  public async fadeOutStop(_durationMs = 0): Promise<void> { this.stop(); }

  public startSleepTimer(durationMs: number, fadeOutMs = 2000): string {
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = null;
    }
    this.sleepTimeout = setTimeout(() => {
      this.fadeOutStop(fadeOutMs).catch(() => this.stop());
      this.leave(true);
    }, durationMs);
    return `Sleep timer set for ${(durationMs / 60000).toFixed(1)} minutes.`;
  }

  public cancelSleepTimer(): string {
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = null;
      return 'Sleep timer cancelled.';
    }
    return 'No sleep timer was set.';
  }
}
