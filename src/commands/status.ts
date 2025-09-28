import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show playback status'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const loopState = manager.isLoopEnabled() ? 'on' : 'off';
    const content = `${manager.getStatus()}\nLoop: ${loopState}`;
    await interaction.reply({ content });
  },
} as Command;
