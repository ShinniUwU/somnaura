import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { logger } from '../utils/logger';
import type { LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stops the current song playback'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    try {
      manager.stop({ requestId: ctx.requestId });
      // Use reply
      await interaction.reply({ content: 'Playback stopped.' });
    } catch (error: any) {
      logger.error(`[Command Stop Error] ${error.message}`, { guildId: interaction.guildId ?? undefined, command: 'stop', scope: 'command', requestId: ctx.requestId }, error);
      await interaction
        .reply({
          content: `An error occurred: ${
            error.message || 'Could not stop playback.'
          }`,
          ephemeral: true,
        })
        .catch((e) => logger.error('Failed to reply in stop command', { guildId: interaction.guildId ?? undefined, command: 'stop', scope: 'command', requestId: ctx.requestId }, e));
    }
  },
} as Command;
