import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from Spotify, SoundCloud, YouTube search, or a URL')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Song name, playlist, or URL')
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),
  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the current track'),
].map((command) => command.toJSON());
