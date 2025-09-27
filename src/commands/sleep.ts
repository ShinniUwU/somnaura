import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type CommandInteraction,
  type CacheType,
  type AutocompleteInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { findSong, getAllSongNames } from '../utils/findSong';

export default {
  data: new SlashCommandBuilder()
    .setName('sleep')
    .setDescription('Play and loop a sound for a set time, then fade out and stop')
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start sleep timer')
        .addStringOption((o) =>
          o
            .setName('query')
            .setDescription('Song name (e.g., rain)')
            .setRequired(false)
            .setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('How long to play (1–600 minutes)')
            .setMinValue(1)
            .setMaxValue(600)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('fadeout_ms')
            .setDescription('Fade-out duration in ms (500–60000)')
            .setMinValue(500)
            .setMaxValue(60000),
        ),
    )
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel sleep timer')),

  async execute(
    interaction: CommandInteraction<CacheType>,
    manager: GuildPlaybackManager,
  ) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'cancel') {
      const msg = manager.cancelSleepTimer();
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }

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

    const minutes = (interaction.options.get('minutes', true).value as number) || 60;
    const fadeMs = (interaction.options.get('fadeout_ms')?.value as number) ?? 2000;
    const query = interaction.options.get('query')?.value as string | undefined;

    try {
      await interaction.editReply({ content: 'Setting up sleep timer…' });
      await manager.join(voiceChannel);

      if (query) {
        const song = findSong(query);
        if (!song) {
          return interaction.editReply({ content: `No matching song found for "${query}". Use /list.` });
        }
        await manager.play(song);
      } else if (!manager.getCurrentSong()) {
        return interaction.editReply({ content: 'Nothing is playing. Provide a song name.' });
      }

      manager.setLoop(true);
      const msg = manager.startSleepTimer(minutes * 60000, fadeMs);
      await interaction.editReply({ content: `Sleep mode: looping for ${minutes} minute(s). ${msg}` });
    } catch (e: any) {
      await interaction.editReply({ content: `Failed to start sleep: ${e.message || e}` });
    }
  },
  async autocomplete(interaction: AutocompleteInteraction<CacheType>) {
    const sub = interaction.options.getSubcommand(false);
    if (sub !== 'start') return;
    const focused = interaction.options.getFocused().toLowerCase();
    const all = getAllSongNames();
    const choices = all
      .filter((n) => n.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
    await interaction.respond(choices);
  },
} as Command;
