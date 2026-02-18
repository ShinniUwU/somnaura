import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Collection } from 'discord.js';
import type { Command } from '../types';
import { logger } from '../utils/logger';

export async function registerCommands(
  commands: Command[],
  clientId: string,
  token: string,
): Promise<void> {
  const rest = new REST({ version: '9' }).setToken(token);
  const commandData = commands.map((cmd) => cmd.data.toJSON());

  try {
    logger.info(`Refreshing ${commands.length} application (/) commands`, { scope: 'boot', event: 'commands_register' });
    const data: any = await rest.put(Routes.applicationCommands(clientId), {
      body: commandData,
    });
    logger.info(`Reloaded ${data.length} application (/) commands`, { scope: 'boot', event: 'commands_registered' });
  } catch (error) {
    logger.error('Error registering commands', { scope: 'boot', event: 'commands_register_fail' }, error);
  }
}

export async function loadCommands(
  commandDir: string = '../commands',
): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const commandPath = path.resolve(baseDir, commandDir);
  logger.info(`Loading commands`, { scope: 'boot', event: 'commands_load' }, { commandPath });

  try {
    const commandFiles = fs
      .readdirSync(commandPath)
      .filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandPath, file);
      try {
        const url = pathToFileURL(filePath).href;
        const commandModule = await import(url);
        const command = (commandModule.default || commandModule) as Command;
        if (command && command.data && typeof command.execute === 'function') {
          logger.info(`Loaded command: ${command.data.name}`, { scope: 'boot', event: 'command_loaded' });
          commands.set(command.data.name, command);
        } else {
          logger.warn(`Command at ${filePath} is missing "data" or "execute"`, { scope: 'boot', event: 'command_invalid' });
        }
      } catch (error) {
        logger.error(`Error loading command file ${filePath}`, { scope: 'boot', event: 'command_load_fail' }, error);
      }
    }
  } catch (error) {
    logger.error(`Error reading commands directory ${commandPath}`, { scope: 'boot', event: 'commands_dir_fail' }, error);
  }

  logger.info(`Loaded ${commands.size} commands`, { scope: 'boot', event: 'commands_loaded' });
  return commands;
}
