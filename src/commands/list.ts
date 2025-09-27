import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import { getAllSongNames } from '../utils/findSong';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('list')
    .setDescription('Lists all available songs'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const songs = getAllSongNames();

    if (songs.length === 0) {
      // Use reply instead of editReply
      return interaction.reply({
        content:
          'No compatible songs found in the `songs` folder or failed to load them.',
      });
    }

    const songList = songs.map((s) => `- ${s}`).join('\n');
    const message = `Available songs:\n${songList}`;

    if (message.length > 2000) {
      // Use reply instead of editReply
      await interaction.reply({
        content: `Available songs:\n${songList.substring(0, 1950)}...`,
      });
    } else {
      // Use reply instead of editReply
      await interaction.reply({ content: message });
    }
  },
} as Command;
