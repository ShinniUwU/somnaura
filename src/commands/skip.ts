import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { logger, type LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song and play the next in queue (soft fade)'),

  async execute(interaction: ChatInputCommandInteraction, manager: GuildPlaybackManager) {
    const ctx: LogContext = { requestId: (interaction as any).requestId, guildId: interaction.guildId ?? undefined };
    try {
      const msg = await manager.skip(250, { requestId: ctx.requestId });
      await interaction.reply({ content: msg });
    } catch (error: any) {
      logger.error(`[Command Skip Error] ${error.message}`, { ...ctx, command: 'skip', scope: 'command' }, error);
      await interaction.reply({ content: `An error occurred: ${error.message || 'Could not skip.'}`, ephemeral: true })
        .catch((e) => logger.error('Failed to reply in skip command', { ...ctx, command: 'skip', scope: 'command' }, e));
    }
  },
} as Command;
