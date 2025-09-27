import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stops the current song playback'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    try {
      manager.stop();
      // Use reply
      await interaction.reply({ content: 'Playback stopped.' });
    } catch (error: any) {
      console.error(
        `[Command Stop Error] Guild ${interaction.guildId}: ${error.message}`,
      );
      // Use reply
      await interaction
        .reply({
          content: `An error occurred: ${
            error.message || 'Could not stop playback.'
          }`,
          ephemeral: true,
        })
        .catch(() => {});
    }
  },
} as Command;
