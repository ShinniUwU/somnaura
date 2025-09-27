import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { getAllSongNames, findSong } from '../utils/findSong';

export default {
  data: new SlashCommandBuilder()
    .setName('random')
    .setDescription('Join and play a random song from your library')
    .addStringOption((o) =>
      o
        .setName('filter')
        .setDescription('Optional substring to filter choices (e.g., rain)'),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
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

    const filter = (interaction.options.get('filter')?.value as string | undefined)?.toLowerCase();
    const names = getAllSongNames().filter((n) => !filter || n.toLowerCase().includes(filter));
    if (names.length === 0) {
      return interaction.editReply({ content: filter ? `No songs matching "${filter}".` : 'Your songs folder is empty. Use /list.' });
    }
    const pick = names[Math.floor(Math.random() * names.length)];
    const song = findSong(pick);
    if (!song) return interaction.editReply({ content: 'Selected song disappeared after reload. Try again.' });

    await manager.join(voiceChannel);
    const msg = await manager.play(song);
    await interaction.editReply({ content: msg + ' (random pick)' });
  },
} as Command;
