import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { ConfigStore } from '../lib/ConfigStore';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show playback status'),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const loopState = manager.isLoopEnabled() ? 'on' : 'off';
    const vol = (ConfigStore.get().volume * 100).toFixed(0) + '%';
    const content = `${manager.getStatus()}\nLoop: ${loopState}\nVolume: ${vol}`;
    await interaction.reply({ content });
  },
} as Command;
