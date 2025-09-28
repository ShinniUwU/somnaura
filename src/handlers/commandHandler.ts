import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Collection } from 'discord.js';
import type { Command } from '../types'; // Use type import

export async function registerCommands(
  commands: Command[],
  clientId: string,
  token: string,
): Promise<void> {
  const rest = new REST({ version: '9' }).setToken(token);
  const commandData = commands.map((cmd) => cmd.data.toJSON());

  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`,
    );
    const data: any = await rest.put(Routes.applicationCommands(clientId), {
      body: commandData,
    });
    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`,
    );
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

export async function loadCommands(
  commandDir: string = '../commands',
): Promise<Collection<string, Command>> {
  const commands = new Collection<string, Command>();
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const commandPath = path.resolve(baseDir, commandDir);
  console.log(`Loading commands from: ${commandPath}`);

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
          console.log(`-> Loaded command: ${command.data.name}`);
          commands.set(command.data.name, command);
        } else {
          console.warn(
            `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property, or structure is incorrect.`,
          );
        }
      } catch (error) {
        console.error(`Error loading command file ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error reading commands directory ${commandPath}:`, error);
  }

  console.log(`Loaded ${commands.size} commands successfully.`);
  return commands;
}
