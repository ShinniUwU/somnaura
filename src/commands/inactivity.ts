import {
  SlashCommandBuilder,
  type CommandInteraction,
  type CacheType,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { ConfigStore } from '../lib/ConfigStore';

export default {
  data: new SlashCommandBuilder()
    .setName('inactivity')
    .setDescription('Get or set auto-disconnect minutes (0 disables)')
    .addSubcommand((s) => s.setName('get').setDescription('Show current value'))
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set minutes (0–120)')
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Minutes before auto-disconnect')
            .setMinValue(0)
            .setMaxValue(120)
            .setRequired(true),
        ),
    ),

  async execute(
    interaction: CommandInteraction<CacheType>,
    _manager: GuildPlaybackManager,
  ) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'get') {
      const m = ConfigStore.get().inactivityMinutes;
      await interaction.reply({ content: `Auto-disconnect: ${m} minute(s). 0 = disabled`, ephemeral: true });
      return;
    }
    const minutes = interaction.options.get('minutes', true).value as number;
    const cfg = ConfigStore.update({ inactivityMinutes: Math.max(0, Math.min(120, minutes)) });
    await interaction.reply({ content: `Auto-disconnect set to ${cfg.inactivityMinutes} minute(s).`, ephemeral: true });
  },
} as Command;

