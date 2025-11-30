import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import type { LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song and play the next in queue (soft fade)'),

  async execute(interaction: ChatInputCommandInteraction, manager: GuildPlaybackManager) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    const msg = await manager.skip(250, { requestId: ctx.requestId }).catch(() => 'Skipped.');
    await interaction.reply({ content: msg });
  },
} as Command;
