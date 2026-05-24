import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../types';
import type { GuildPlaybackManager } from '../lib/GuildPlaybackManager';
import { ConfigStore, type VoiceConfig } from '../lib/ConfigStore';

function fmt(): string {
  const c = ConfigStore.get();
  return `Bitrate: ${c.opusBitrate} bps\nFEC: ${c.opusFec}\nPLP: ${c.opusPlp}\nMax Missed Frames: ${c.maxMissedFrames}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('quality')
    .setDescription('Show or set audio encoder quality')
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Show current quality settings'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set audio quality parameters')
        .addIntegerOption((o) =>
          o
            .setName('bitrate')
            .setDescription('Opus bitrate in bps (16000–512000)')
            .setMinValue(16000)
            .setMaxValue(512000),
        )
        .addBooleanOption((o) =>
          o
            .setName('fec')
            .setDescription('Enable in-band FEC (true/false)'),
        )
        .addNumberOption((o) =>
          o
            .setName('plp')
            .setDescription('Expected packet loss 0..1 (e.g., 0.1)')
            .setMinValue(0)
            .setMaxValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName('max_missed_frames')
            .setDescription('Tolerance for missed frames (1–200)')
            .setMinValue(1)
            .setMaxValue(200),
        ),
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    manager: GuildPlaybackManager,
  ) {
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'show') {
      await interaction.editReply({ content: 'Current quality:\n' + fmt() });
      return;
    }

    // set
    const bitrate = interaction.options.get('bitrate')?.value as number | undefined;
    const fec = interaction.options.get('fec')?.value as boolean | undefined;
    const plp = interaction.options.get('plp')?.value as number | undefined;
    const mmf = interaction.options.get('max_missed_frames')?.value as number | undefined;

    const updates: Partial<VoiceConfig> = {};
    if (typeof bitrate === 'number') updates.opusBitrate = bitrate;
    if (typeof fec === 'boolean') updates.opusFec = fec;
    if (typeof plp === 'number') updates.opusPlp = plp;
    if (typeof mmf === 'number') updates.maxMissedFrames = mmf;

    if (Object.keys(updates).length === 0) {
      await interaction.editReply({ content: 'No changes provided.' });
      return;
    }

    const newCfg = ConfigStore.update(updates);
    manager.applyConfig();

    await interaction.editReply({
      content: 'Updated quality settings:\n' + fmt() +
        '\nNote: new bitrate/FEC/PLP apply to the next track or when playback restarts.',
    });
  },
} as Command;
