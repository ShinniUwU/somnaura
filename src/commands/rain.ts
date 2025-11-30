import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { findSong } from '../utils/findSong';
import { logger, type LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('rain')
    .setDescription('Quick-start rain: loop and optionally sleep for N minutes')
    .addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Optional sleep timer (1–600 minutes)')
        .setMinValue(1)
        .setMaxValue(600),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId, command: 'rain', guildId: interaction.guildId ?? undefined };
    await interaction.deferReply();

    if (!interaction.member || !('voice' in interaction.member)) {
      return interaction.editReply({ content: 'Could not determine your voice status.' });
    }
    const voiceChannel = (interaction.member as any).voice?.channel;
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      return interaction.editReply({ content: 'Join a voice channel first.' });
    }
    const permissions = voiceChannel.permissionsFor(interaction.client.user!);
    if (!permissions || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      return interaction.editReply({ content: 'I need join and speak permissions.' });
    }

    const song = findSong('rain');
    if (!song) return interaction.editReply({ content: 'No file matching "rain" found. Use /list.' });

    try {
      await manager.join(voiceChannel, { requestId: ctx.requestId });
      manager.setLoop(true);
      const msg = await manager.play(song, { requestId: ctx.requestId });
      const mins = (interaction.options.get('minutes')?.value as number | undefined);
      if (mins && mins > 0) {
        const t = manager.startSleepTimer(mins * 60000, 2000);
        await interaction.editReply({ content: `${msg} (looping)\n${t}` });
      } else {
        await interaction.editReply({ content: `${msg} (looping)` });
      }
    } catch (error: any) {
      logger.error('Rain command failed', ctx, error);
      await interaction.editReply({ content: `Failed to play rain: ${error.message || error}` });
    }
  },
} as Command;
