import type {
  SlashCommandBuilder,
  CommandInteraction,
  CacheType,
  AutocompleteInteraction,
  BaseGuildVoiceChannel,
} from 'discord.js';
// Verify: Does src/lib/GuildPlaybackManager.ts exist exactly like this?
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

// Define structure for command files
export interface Command {
  data: SlashCommandBuilder;
  execute: (
    interaction: CommandInteraction<CacheType>,
    manager: GuildPlaybackManager,
  ) => Promise<void>;
  autocomplete?: (
    interaction: AutocompleteInteraction<CacheType>,
  ) => Promise<void>;
}

// Interface for song details
export interface Song {
  name: string;
  path: string;
}

// Type guard for voice channel check
export function isVoiceChannel(channel: any): channel is BaseGuildVoiceChannel {
  return channel && channel.isVoiceBased();
}
