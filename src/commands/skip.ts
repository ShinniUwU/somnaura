import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song and play the next in queue (soft fade)'),

  async execute(interaction: ChatInputCommandInteraction, manager: GuildPlaybackManager) {
    const msg = await manager.skip(250).catch(() => 'Skipped.');
    await interaction.reply({ content: msg });
  },
} as Command;

