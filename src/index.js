import 'dotenv/config';
import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { Player, QueryType, useQueue } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { startWebPanel } from './web.js';

const {
  DISCORD_TOKEN,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  DISCORD_GUILD_ID,
  MUSIC_TEXT_CHANNEL_ID,
  WEB_VOICE_CHANNEL_ID,
  WEB_TEXT_CHANNEL_ID,
} = process.env;

if (!DISCORD_TOKEN) {
  throw new Error('Set DISCORD_TOKEN in .env');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const player = new Player(client, {
  ytdlOptions: {
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  },
});

await player.extractors.loadMulti(DefaultExtractors, {
  spotify: SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET
    ? {
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
      }
    : undefined,
});

player.events.on('playerStart', (queue, track) => {
  queue.metadata.channel.send(`Playing: **${track.title}**`);
});

player.events.on('audioTrackAdd', (queue, track) => {
  queue.metadata.channel.send(`Added to queue: **${track.title}**`);
});

player.events.on('audioTracksAdd', (queue, tracks) => {
  queue.metadata.channel.send(`Added **${tracks.length}** tracks to queue.`);
});

player.events.on('error', (queue, error) => {
  console.error(error);
  queue?.metadata?.channel?.send('Playback error. Check the bot logs.');
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  setBotStatus('/play');

  setInterval(updateBotActivity, 3_000);

  startWebPanel({
    player,
    playFromWeb,
    searchFromWeb: (query) => searchTracks(query, client.user, {
      engines: [QueryType.YOUTUBE_SEARCH, QueryType.SOUNDCLOUD_SEARCH, QueryType.SPOTIFY_SEARCH],
      perEngineLimit: 5,
    }),
    getVoiceChannels,
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }

  if (!interaction.isChatInputCommand() || !interaction.guild) {
    return;
  }

  if (!isMusicTextChannel(interaction.channelId)) {
    await interaction.reply({
      content: `Use music commands in <#${MUSIC_TEXT_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (interaction.commandName === 'play') {
      await interaction.deferReply();

      await playMusic({
        member: interaction.member,
        channel: interaction.channel,
        user: interaction.user,
        query: interaction.options.getString('query', true),
        send: (content) => interaction.editReply(content),
      });
      return;
    }

    const queue = useQueue(interaction.guild.id);

    if (!queue?.isPlaying()) {
      await interaction.reply({ content: 'Nothing is playing right now.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === 'skip') {
      queue.node.skip();
      await interaction.reply('Skipped current track.');
      return;
    }

    if (interaction.commandName === 'stop') {
      queue.delete();
      await interaction.reply('Stopped playback and cleared the queue.');
      return;
    }

    if (interaction.commandName === 'pause') {
      queue.node.pause();
      await interaction.reply('Paused playback.');
      return;
    }

    if (interaction.commandName === 'resume') {
      queue.node.resume();
      await interaction.reply('Resumed playback.');
      return;
    }

    if (interaction.commandName === 'queue') {
      await interaction.reply(formatQueue(queue));
      return;
    }

    if (interaction.commandName === 'nowplaying') {
      const track = queue.currentTrack;
      await interaction.reply(track ? `Now playing: **${track.author} - ${track.title}**` : 'Nothing is playing right now.');
    }
  } catch (error) {
    console.error(error);
    await safeInteractionError(interaction);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith('!')) {
    return;
  }

  if (!isMusicTextChannel(message.channelId)) {
    return;
  }

  const [commandName, ...args] = message.content.slice(1).trim().split(/\s+/);
  const query = args.join(' ');

  try {
    if (commandName === 'play' || commandName === 'p') {
      if (!query) {
        await message.reply('Use: `!play song name or URL`');
        return;
      }

      await playMusic({
        guild: message.guild,
        member: message.member,
        channel: getMusicTextChannel() ?? message.channel,
        user: message.author,
        query,
        send: (content) => message.reply(content),
      });
      return;
    }

    const queue = useQueue(message.guild.id);

    if (!queue?.isPlaying()) {
      await message.reply('Nothing is playing right now.');
      return;
    }

    if (commandName === 'skip') {
      queue.node.skip();
      await message.reply('Skipped current track.');
      return;
    }

    if (commandName === 'stop') {
      queue.delete();
      await message.reply('Stopped playback and cleared the queue.');
      return;
    }

    if (commandName === 'pause') {
      queue.node.pause();
      await message.reply('Paused playback.');
      return;
    }

    if (commandName === 'resume') {
      queue.node.resume();
      await message.reply('Resumed playback.');
      return;
    }

    if (commandName === 'queue') {
      await message.reply(formatQueue(queue));
      return;
    }

    if (commandName === 'nowplaying' || commandName === 'np') {
      const track = queue.currentTrack;
      await message.reply(track ? `Now playing: **${track.title}**` : 'Nothing is playing right now.');
    }
  } catch (error) {
    console.error(error);
    await message.reply('Command failed. Check the bot logs.');
  }
});

async function playMusic({ member, channel, user, query, send }) {
  const memberVoiceChannel = member.voice.channel;

  if (!memberVoiceChannel) {
    await send('Join a voice channel first.');
    return;
  }

  const searchResult = await player.search(query, {
    requestedBy: user,
  });

  const candidateTracks = /^https?:\/\//i.test(query)
    ? searchResult.tracks
    : await searchTracks(query, user);

  if (!searchResult.hasTracks() && candidateTracks.length === 0) {
    await send('No tracks found.');
    return;
  }

  const playable = searchResult.playlist
    ? searchResult
    : (candidateTracks.length > 0 ? candidateTracks[0] : searchResult.tracks[0]);

  await player.play(memberVoiceChannel, playable, {
    nodeOptions: {
      metadata: {
        channel: getMusicTextChannel() ?? channel,
      },
      selfDeaf: true,
      volume: 70,
    },
  });

  await send(`Queued: **${searchResult.playlist?.title ?? playable.title ?? searchResult.tracks[0].title}**`);
}

async function playFromWeb(query, voiceChannelId = null) {
  const guild = client.guilds.cache.get(DISCORD_GUILD_ID) ?? client.guilds.cache.first();

  if (!guild) {
    throw new Error('Bot is not connected to any guild');
  }

  const voiceChannel = resolveWebVoiceChannel(guild, voiceChannelId);

  if (!voiceChannel) {
    throw new Error('Join a voice channel first, or set WEB_VOICE_CHANNEL_ID in .env');
  }

  const textChannel = WEB_TEXT_CHANNEL_ID ? guild.channels.cache.get(WEB_TEXT_CHANNEL_ID) : null;
  const musicTextChannel = getMusicTextChannel();
  const searchResult = await player.search(query, { requestedBy: client.user });
  const candidateTracks = /^https?:\/\//i.test(query)
    ? searchResult.tracks
    : await searchTracks(query, client.user);

  if (!searchResult.hasTracks() && candidateTracks.length === 0) {
    throw new Error('No tracks found');
  }

  const playable = searchResult.playlist
    ? searchResult
    : (candidateTracks.length > 0 ? candidateTracks[0] : searchResult.tracks[0]);

  await player.play(voiceChannel, playable, {
    nodeOptions: {
      metadata: {
        channel: musicTextChannel ?? textChannel ?? { send: () => Promise.resolve() },
      },
      selfDeaf: true,
      volume: 70,
    },
  });
}

function isMusicTextChannel(channelId) {
  return !MUSIC_TEXT_CHANNEL_ID || channelId === MUSIC_TEXT_CHANNEL_ID;
}

function getMusicTextChannel() {
  if (!MUSIC_TEXT_CHANNEL_ID) return null;

  return client.channels.cache.get(MUSIC_TEXT_CHANNEL_ID) ?? null;
}

function resolveWebVoiceChannel(guild, voiceChannelId = null) {
  if (voiceChannelId) {
    const channel = guild.channels.cache.get(voiceChannelId);

    if (channel?.isVoiceBased()) {
      return channel;
    }
  }

  if (WEB_VOICE_CHANNEL_ID) {
    return guild.channels.cache.get(WEB_VOICE_CHANNEL_ID);
  }

  return guild.channels.cache.find((channel) => (
    channel.isVoiceBased()
    && channel.members.some((member) => !member.user.bot)
  ));
}

function getVoiceChannels() {
  const guild = client.guilds.cache.get(DISCORD_GUILD_ID) ?? client.guilds.cache.first();

  if (!guild) return [];

  return guild.channels.cache
    .filter((channel) => channel.isVoiceBased())
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      members: channel.members.filter((member) => !member.user.bot).size,
    }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
}

async function handleAutocomplete(interaction) {
  const query = interaction.options.getFocused();

  if (!query || query.length < 2) {
    await interaction.respond([]);
    return;
  }

  const search = searchTracks(query, interaction.user, {
    engines: [QueryType.YOUTUBE_SEARCH, QueryType.SOUNDCLOUD_SEARCH],
    perEngineLimit: 5,
  }).then((tracks) => tracks.slice(0, 10));
  const tracks = await withTimeout(search, 1_500, []);

  await interaction.respond(
    tracks.map((track) => ({
      name: truncate(`${track.author} - ${track.title} (${track.duration})`, 100),
      value: truncate(`${track.author} - ${track.title}`, 100),
    })),
  );
}

async function searchTracks(query, user, options = {}) {
  if (/^https?:\/\//i.test(query)) {
    const result = await player.search(query, { requestedBy: user });
    return result.tracks;
  }

  const searchEngines = options.engines ?? [
    QueryType.AUTO_SEARCH,
    QueryType.YOUTUBE_SEARCH,
    QueryType.SOUNDCLOUD_SEARCH,
    QueryType.SPOTIFY_SEARCH,
  ];
  const perEngineLimit = options.perEngineLimit ?? 8;
  const queries = getSearchVariants(query);

  const results = await Promise.allSettled(
    queries.flatMap((searchQuery) => (
      searchEngines.map((searchEngine) => player.search(searchQuery, { requestedBy: user, searchEngine }))
    )),
  );

  const tracks = [];
  const seen = new Set();

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value.hasTracks()) {
      continue;
    }

    for (const track of result.value.tracks.slice(0, perEngineLimit)) {
      const key = `${track.author}:${track.title}`.toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        tracks.push(track);
      }
    }
  }

  return tracks;
}

function getSearchVariants(query) {
  const words = query.split(/\s+/).filter(Boolean);

  if (words.length < 2) {
    return [query];
  }

  const reversed = [...words].reverse().join(' ');
  return reversed.toLowerCase() === query.toLowerCase() ? [query] : [query, reversed];
}

async function safeInteractionError(interaction) {
  try {
    const response = { content: 'Command failed. Check the bot logs.', flags: MessageFlags.Ephemeral };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
      return;
    }

    await interaction.reply(response);
  } catch (error) {
    if (error.code !== 10062) {
      console.error(error);
    }
  }
}

function updateBotActivity() {
  const queue = getActiveQueue();

  if (!queue?.currentTrack || !queue.node.isPlaying()) {
    setBotStatus('/play');
    return;
  }

  const track = queue.currentTrack;
  const timestamp = queue.node.getTimestamp();
  const progress = queue.node.createProgressBar({ length: 5, timecodes: false }) ?? '';
  const time = timestamp ? `${timestamp.current.label}/${timestamp.total.label}` : track.duration;
  const label = truncate(`${time} ${progress} | ${track.author} - ${track.title}`, 64);

  setBotStatus(label);
}

function setBotStatus(text) {
  client.user?.setPresence({
    activities: [
      {
        name: 'custom',
        state: text,
        type: ActivityType.Custom,
      },
    ],
    status: 'online',
  });
}

function getActiveQueue() {
  for (const queue of player) {
    if (queue.node.isPlaying()) {
      return queue;
    }
  }

  return null;
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatQueue(queue) {
  const current = queue.currentTrack ? `Now: **${queue.currentTrack.title}**` : 'Nothing is playing.';
  const upcoming = queue.tracks
    .toArray()
    .slice(0, 10)
    .map((track, index) => `${index + 1}. ${track.title}`)
    .join('\n');

  return upcoming ? `${current}\n\n${upcoming}` : `${current}\n\nQueue is empty.`;
}

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

client.login(DISCORD_TOKEN);
