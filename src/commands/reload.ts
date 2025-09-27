import {
  SlashCommandBuilder,
  type CommandInteraction,
  type CacheType,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { reloadSongs, getAllSongNames } from '../utils/findSong';

export default {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload the songs directory'),

  async execute(
    interaction: CommandInteraction<CacheType>,
    _manager: GuildPlaybackManager,
  ) {
    reloadSongs();
    const n = getAllSongNames().length;
    await interaction.reply({ content: `Reloaded songs. Found ${n} file(s).`, ephemeral: true });
  },
} as Command;

