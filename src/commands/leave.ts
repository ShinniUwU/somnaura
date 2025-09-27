import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

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
    try {
      manager.leave();
      // Use reply
      await interaction.reply({ content: 'Left the voice channel.' });
    } catch (error: any) {
      console.error(
        `[Command Leave Error] Guild ${interaction.guildId}: ${error.message}`,
      );
      // Use reply
      await interaction
        .reply({
          content: `An error occurred: ${
            error.message || 'Could not leave channel.'
          }`,
          ephemeral: true,
        })
        .catch(() => {});
    }
  },
} as Command;
