import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { findSong, getAllSongNames } from '../utils/findSong';

const DISCORD_MESSAGE_LIMIT = 2000;

function formatQueueMessage(items: Array<{ name: string }>): string {
  const header = 'In queue:\n';
  const lines = items.map((s, i) => `${i + 1}. ${s.name}`);
  let content = header;

  for (let i = 0; i < lines.length; i += 1) {
    const line = `${lines[i]}\n`;
    if ((content + line).length > DISCORD_MESSAGE_LIMIT) {
      const remaining = lines.length - i;
      const suffix = `\n...and ${remaining} more`;
      const base = content.trimEnd();
      if (base.length + suffix.length <= DISCORD_MESSAGE_LIMIT) {
        return `${base}${suffix}`;
      }
      const truncatedBase = base.slice(0, Math.max(0, DISCORD_MESSAGE_LIMIT - suffix.length));
      return `${truncatedBase}${suffix}`;
    }
    content += line;
  }

  return content.trimEnd();
}

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
    try {
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
        await interaction.reply({ content: formatQueueMessage(items) });
        return;
      }
      if (sub === 'clear') {
        manager.clearQueue();
        await interaction.reply({ content: 'Queue cleared.' });
        return;
      }
    } catch (error) {
      const msg = `Queue operation failed: ${(error as Error).message || 'Unknown error'}`;
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: msg, ephemeral: true });
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch {}
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
