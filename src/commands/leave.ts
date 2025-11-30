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
    .setName('leave')
    .setDescription(
      'Stops playback and disconnects the bot from the voice channel',
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    try {
      manager.leave(false, { requestId: ctx.requestId });
      // Use reply
      await interaction.reply({ content: 'Left the voice channel.' });
    } catch (error: any) {
      logger.error(`[Command Leave Error] ${error.message}`, { guildId: interaction.guildId ?? undefined, command: 'leave', scope: 'command', requestId: ctx.requestId }, error);
      await interaction
        .reply({
          content: `An error occurred: ${
            error.message || 'Could not leave channel.'
          }`,
          ephemeral: true,
        })
        .catch((e) => logger.error('Failed to reply in leave command', { guildId: interaction.guildId ?? undefined, command: 'leave', scope: 'command', requestId: ctx.requestId }, e));
    }
  },
} as Command;
