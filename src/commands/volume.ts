import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { ConfigStore } from '../lib/ConfigStore';

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Get or set playback volume')
    .addSubcommand((s) => s.setName('get').setDescription('Show current volume'))
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set volume (0–200%)')
        .addIntegerOption((o) =>
          o
            .setName('percent')
            .setDescription('0–200')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(200),
        ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    // Ack early to avoid interaction timeouts and race conditions
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();
    if (sub === 'get') {
      const v = ConfigStore.get().volume;
      await interaction.editReply({ content: `Volume: ${(v * 100).toFixed(0)}%` });
      return;
    }
    const percent = interaction.options.get('percent', true).value as number;
    const vol = Math.max(0, Math.min(200, percent)) / 100;
    const msg = manager.setVolume(vol);
    await interaction.editReply({ content: msg });
  },
} as Command;
