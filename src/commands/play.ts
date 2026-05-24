import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { type Command, isVoiceChannel, type Song } from '../types';
import { findSong } from '../utils/findSong';
import { getAllSongNames } from '../utils/findSong';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { logger } from '../utils/logger';
import type { LogContext } from '../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Joins your channel and plays a song from the local folder')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Name (or part of name) of the song file')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    // Defer immediately as joining/playing might take time
    await interaction.deferReply();

    if (!interaction.member || !('voice' in interaction.member)) {
      return interaction.editReply({
        content: 'Could not determine your voice status.',
      });
    }
    const voiceChannel = interaction.member.voice?.channel ?? null;

    if (!isVoiceChannel(voiceChannel)) {
      return interaction.editReply({
        content: 'You need to be in a voice channel to play music!',
      });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user!);
    if (
      !permissions ||
      !permissions.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      return interaction.editReply({
        content: 'I need permissions to join and speak in your voice channel!',
      });
    }

    const queryOption = interaction.options.get('query', true);
    const query = queryOption.value as string;
    const song = findSong(query);

    if (!song) {
      return interaction.editReply({
        content: `No matching song found for "${query}". Use /list to see available songs.`,
      });
    }

    try {
      // Feedback *after* deferral
      await interaction.editReply({
        content: `Joining ${voiceChannel.name} and searching for "${query}"...`,
      });

      await manager.join(voiceChannel, { requestId: ctx.requestId });
      const playMessage = await manager.play(song, { requestId: ctx.requestId });
      await interaction.editReply({ content: playMessage }); // Final update
    } catch (error: any) {
      logger.error(
        `[Command Play Error] ${error.message}`,
        { guildId: interaction.guildId ?? undefined, command: 'play', scope: 'command', requestId: ctx.requestId },
        error,
      );
      const replyContent = {
        content: `An error occurred: ${
          error.message || 'Could not play the song.'
        }`,
      };
      try {
        // Already deferred, so always edit
        await interaction.editReply(replyContent);
      } catch (replyError) {
        logger.error(
          'Failed to send error reply on play command',
          { guildId: interaction.guildId ?? undefined, command: 'play', scope: 'command', requestId: ctx.requestId },
          replyError,
        );
      }
    }
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const all = getAllSongNames();
    const choices = all
      .filter((n) => n.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
    await interaction.respond(choices);
  },
} as Command;
