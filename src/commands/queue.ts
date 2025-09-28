import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { findSong, getAllSongNames } from '../utils/findSong';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Manage the play queue')
    .addSubcommand((s) =>
      s.setName('add').setDescription('Add a song to the queue')
        .addStringOption((o) => o.setName('query').setDescription('Song name').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show queued songs'))
    .addSubcommand((s) => s.setName('clear').setDescription('Clear the queue')),

  async execute(interaction: ChatInputCommandInteraction, manager: GuildPlaybackManager) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const q = interaction.options.get('query', true).value as string;
      const song = findSong(q);
      if (!song) {
        await interaction.reply({ content: `No match for "${q}". Use /list.`, ephemeral: true });
        return;
      }
      const msg = manager.enqueue(song);
      await interaction.reply({ content: msg });
      return;
    }
    if (sub === 'list') {
      const items = manager.getQueue();
      if (items.length === 0) {
        await interaction.reply({ content: 'Queue is empty.', ephemeral: true });
        return;
      }
      const names = items.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
      await interaction.reply({ content: `In queue:\n${names}` });
      return;
    }
    if (sub === 'clear') {
      manager.clearQueue();
      await interaction.reply({ content: 'Queue cleared.' });
      return;
    }
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = getAllSongNames()
      .filter((n) => n.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
    await interaction.respond(choices);
  },
} as Command;

