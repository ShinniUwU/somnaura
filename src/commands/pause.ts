import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import type { LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback (with brief silence to prevent pops)'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    const ok = manager.pause({ requestId: ctx.requestId });
    await interaction.reply({ content: ok ? 'Paused.' : 'Nothing to pause.' });
  },
} as Command;
