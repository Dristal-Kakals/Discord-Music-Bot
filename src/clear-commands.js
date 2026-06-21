import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

if (DISCORD_GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: [] });
  console.log('Cleared guild slash commands.');
} else {
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: [] });
  console.log('Cleared global slash commands.');
}
