import {
  SlashCommandBuilder,
  type CommandInteraction,
  type CacheType,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback if paused'),

  async execute(
    interaction: CommandInteraction<CacheType>,
    manager: GuildPlaybackManager,
  ) {
    const ok = manager.resume();
    await interaction.reply({ content: ok ? 'Resumed.' : 'Nothing to resume.' });
  },
} as Command;

