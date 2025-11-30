import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { logger } from '../utils/logger';
import type { LogContext } from '../utils/logger';

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
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    const ctx: LogContext = { requestId: (interaction as any).requestId };
    try {
      const mode = (interaction.options.get('mode')?.value as string) ?? 'toggle';
      let replyMessage = '';
      if (mode === 'on') replyMessage = manager.setLoop(true);
      else if (mode === 'off') replyMessage = manager.setLoop(false);
      else replyMessage = manager.toggleLoop();
      await interaction.reply({ content: replyMessage });
    } catch (error: any) {
      logger.error(`[Command Loop Error] ${error.message}`, { guildId: interaction.guildId ?? undefined, command: 'loop', scope: 'command', requestId: ctx.requestId }, error);
      await interaction
        .reply({
          content: `An error occurred: ${error.message || 'Could not set loop.'}`,
          ephemeral: true,
        })
        .catch((e) => logger.error('Failed to reply in loop command', { guildId: interaction.guildId ?? undefined, command: 'loop', scope: 'command', requestId: ctx.requestId }, e));
    }
  },
} as Command;
