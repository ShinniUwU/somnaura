import {
  SlashCommandBuilder,
  type CommandInteraction,
  type CacheType,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';

export default {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Control looping for the current or next song')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('on | off | toggle')
        .addChoices(
          { name: 'toggle', value: 'toggle' },
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ),
    ),

  async execute(
    interaction: CommandInteraction<CacheType>,
    manager: GuildPlaybackManager,
  ) {
    try {
      const mode = (interaction.options.get('mode')?.value as string) ?? 'toggle';
      let replyMessage = '';
      if (mode === 'on') replyMessage = manager.setLoop(true);
      else if (mode === 'off') replyMessage = manager.setLoop(false);
      else replyMessage = manager.toggleLoop();
      await interaction.reply({ content: replyMessage });
    } catch (error: any) {
      console.error(`[Command Loop Error] Guild ${interaction.guildId}: ${error.message}`);
      await interaction
        .reply({
          content: `An error occurred: ${error.message || 'Could not set loop.'}`,
          ephemeral: true,
        })
        .catch(() => {});
    }
  },
} as Command;
