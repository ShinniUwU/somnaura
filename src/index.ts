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

dotenv.config();

// --- Environment Variable Check ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error('FATAL ERROR: BOT_TOKEN or CLIENT_ID is missing in .env file.');
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
client.commands = loadCommands();
client.playbackManagers = new Map<string, GuildPlaybackManager>();

// --- Register Commands ---
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
  console.log(`Bot ID: ${readyClient.user.id}`);

  if (CLIENT_ID !== readyClient.user.id) {
    console.warn(
      `WARNING: CLIENT_ID in .env (${CLIENT_ID}) does not match actual bot ID (${readyClient.user.id}). Commands might fail to register or work correctly.`,
    );
  }

  if (client.commands.size === 0) {
    console.error('No commands were loaded. Skipping registration.');
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
      console.log(
        `Cleaned up stale playback manager for guild ${guildId} (not found).`,
      );
    }
  }
});

// --- Handle Interactions ---
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle Autocomplete Separately
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(
        `Error handling autocomplete for ${interaction.commandName}:`,
        error,
      );
    }
    return; // Stop processing if autocomplete
  }

  // Handle Slash Commands
  if (!interaction.isChatInputCommand() || !interaction.guildId) return; // Use isChatInputCommand

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    try {
      // --- Reverted to ephemeral: true ---
      await interaction.reply({
        content: 'Error: Command not found!',
        ephemeral: true,
      });
    } catch {}
    return;
  }

  // --- Get or Create Guild Playback Manager ---
  let manager = client.playbackManagers.get(interaction.guildId);
  if (!manager) {
    const guildId = interaction.guildId;
    manager = new GuildPlaybackManager(guildId, (error) => {
      console.error(`[FATAL MANAGER ERROR] Guild ${guildId}: ${error.message}`);
      const deadManager = client.playbackManagers.get(guildId);
      if (deadManager) {
        deadManager.destroy();
        client.playbackManagers.delete(guildId);
      }
    });
    client.playbackManagers.set(interaction.guildId, manager);
  }

  // --- Execute Command ---
  try {
    await command.execute(interaction, manager);
  } catch (error) {
    console.error(
      `Error executing command ${interaction.commandName} for guild ${interaction.guildId}:`,
      error,
    );
    try {
      // --- Reverted to ephemeral: true ---
      const replyOptions = {
        content: 'There was an error while executing this command!',
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        // Edit reply content only
        await interaction.editReply({ content: replyOptions.content });
      } else {
        await interaction.reply(replyOptions);
      }
    } catch (replyError) {
      console.error(
        `Failed to send error reply for command ${interaction.commandName} in guild ${interaction.guildId}:`,
        replyError,
      );
    }
  }
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
