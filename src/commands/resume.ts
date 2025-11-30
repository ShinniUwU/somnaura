import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import type { LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback if paused'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    const ok = manager.resume({ requestId: ctx.requestId });
    await interaction.reply({ content: ok ? 'Resumed.' : 'Nothing to resume.' });
  },
} as Command;
