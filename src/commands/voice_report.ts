import {
  SlashCommandBuilder,
  type CommandInteraction,
  type CacheType,
} from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('voice-report')
    .setDescription('Prints a dependency report for voice (FFmpeg, Opus, sodium)'),

  async execute(
    interaction: CommandInteraction<CacheType>,
    _manager: GuildPlaybackManager,
  ) {
    const report = generateDependencyReport();
    // Trim if needed to stay under message limit
    const content = report.length > 1950 ? report.slice(0, 1950) + '\n…' : report;
    await interaction.reply({ content: '```\n' + content + '\n```', ephemeral: true });
  },
} as Command;

