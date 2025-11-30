import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Partials,
  MessageFlags,
} from 'discord.js';
import dotenv from 'dotenv';
import { GuildPlaybackManager } from './lib/GuildPlaybackManager';
import { loadCommands, registerCommands } from './handlers/commandHandler';
import type { Command } from './types';
import { logger } from './utils/logger';

dotenv.config();

// --- Environment Variable Check ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  logger.error('FATAL ERROR: BOT_TOKEN or CLIENT_ID is missing in .env file.', { scope: 'boot' });
  process.exit(1);
}
// --- End Check ---

// --- Extend Client ---
declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, Command>;
    playbackManagers: Map<string, GuildPlaybackManager>;
  }
}

// --- Initialize Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
}) as Client;

// --- Initialize Collections ---
client.commands = await loadCommands();
client.playbackManagers = new Map<string, GuildPlaybackManager>();

// --- Register Commands ---
client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}!`, { scope: 'boot' });
  logger.info(`Bot ID: ${readyClient.user.id}`, { scope: 'boot' });

  if (CLIENT_ID !== readyClient.user.id) {
    logger.warn(
      `CLIENT_ID in .env (${CLIENT_ID}) does not match actual bot ID (${readyClient.user.id}). Commands might fail to register or work correctly.`,
      { scope: 'boot' },
    );
  }

  if (client.commands.size === 0) {
    logger.error('No commands were loaded. Skipping registration.', { scope: 'boot' });
    return;
  }
  await registerCommands(
    Array.from(client.commands.values()),
    CLIENT_ID,
    BOT_TOKEN,
  );

  const currentGuildIds = readyClient.guilds.cache.map((guild) => guild.id);
  for (const guildId of client.playbackManagers.keys()) {
    if (!currentGuildIds.includes(guildId)) {
      client.playbackManagers.get(guildId)?.destroy();
      client.playbackManagers.delete(guildId);
      logger.info(
        `Cleaned up stale playback manager for guild ${guildId} (not found).`,
        { guildId, scope: 'boot' },
      );
    }
  }
});

// --- Handle Interactions ---
client.on(Events.InteractionCreate, async (interaction) => {
  const requestId = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
  (interaction as any).requestId = requestId;
  // Handle Autocomplete Separately
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error(
        `Error handling autocomplete for ${interaction.commandName}: ${(error as Error).message}`,
        { command: interaction.commandName, guildId: interaction.guildId ?? undefined, scope: 'autocomplete' },
        error,
      );
    }
    return; // Stop processing if autocomplete
  }

  // Handle Slash Commands
  if (!interaction.isChatInputCommand() || !interaction.guildId) return; // Use isChatInputCommand

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`No command matching ${interaction.commandName} was found.`, { command: interaction.commandName, guildId: interaction.guildId, scope: 'interaction' });
    try {
      await interaction.reply({
        content: 'Error: Command not found!',
        ephemeral: true,
      });
    } catch (replyError) {
      logger.error('Failed to reply for missing command', { command: interaction.commandName, guildId: interaction.guildId, scope: 'interaction' }, replyError);
    }
    return;
  }

  // --- Get or Create Guild Playback Manager ---
  let manager = client.playbackManagers.get(interaction.guildId);
  if (!manager) {
    const guildId = interaction.guildId;
    manager = new GuildPlaybackManager(guildId, (error) => {
      logger.error(`[FATAL MANAGER ERROR] ${error.message}`, { guildId, scope: 'manager' }, error);
      const deadManager = client.playbackManagers.get(guildId);
      if (deadManager) {
        deadManager.destroy();
        client.playbackManagers.delete(guildId);
      }
    });
    client.playbackManagers.set(interaction.guildId, manager);
  }

  logger.info('Command received', { guildId: interaction.guildId ?? undefined, command: interaction.commandName, scope: 'interaction', requestId, event: 'command_start' });
  // --- Execute Command ---
  try {
    await command.execute(interaction, manager);
  } catch (error) {
    logger.error(
      `Error executing command ${interaction.commandName} for guild ${interaction.guildId}: ${(error as Error).message}`,
      { command: interaction.commandName, guildId: interaction.guildId, scope: 'interaction' },
      error,
    );
    const content = 'There was an error while executing this command!';
    try {
      if (interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
      } else if (interaction.deferred) {
        await interaction.editReply({ content });
        // Send a private follow-up so errors are not leaked publicly
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        // Try to remove the public placeholder if it exists
        await interaction.deleteReply().catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch (replyError) {
      console.error(
        `Failed to send error reply for command ${interaction.commandName} in guild ${interaction.guildId}:`,
        replyError,
      );
    }
  }
});

// Auto-leave when alone in the channel after a grace period
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;
  const manager = client.playbackManagers.get(guildId);
  if (!manager) return;
  const channelId = manager.getChannelId();
  if (!channelId) return;
  const channel = newState.guild.channels.cache.get(channelId);
  if (!channel || !('isVoiceBased' in channel) || !(channel as any).isVoiceBased()) return;
  const members = (channel as any).members;
  const nonBots = members.filter((m: any) => !m.user?.bot);
  if (nonBots.size === 0) manager.scheduleAloneDisconnect();
  else manager.cancelAloneDisconnect();
});

// Clean up manager when bot is removed from a guild to avoid stale entries
client.on(Events.GuildDelete, (guild) => {
  const id = guild.id;
  const mgr = client.playbackManagers.get(id);
  if (mgr) {
    try { mgr.destroy(); } catch {}
    client.playbackManagers.delete(id);
    console.log(`Destroyed playback manager for removed guild ${id}.`);
  }
});

// --- Graceful Shutdown ---
const shutdown = () => {
  console.log('Shutting down gracefully...');
  client.playbackManagers.forEach((manager) => manager.destroy());
  client.destroy();
  console.log('Client destroyed. Exiting.');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Login ---
client.login(BOT_TOKEN);

console.log('Makeshift bot refactor is starting...');
