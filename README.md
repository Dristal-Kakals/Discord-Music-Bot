# Discord Music Bot

Bot for Discord voice channels with slash commands and support for Spotify links/search, SoundCloud links/search, playlists, and regular text search.

Spotify does not provide raw audio streams for third-party bots. The bot reads Spotify metadata and plays a matching stream through supported extractors. SoundCloud can be played directly when available.

## Requirements

- Node.js 20+
- A Discord application and bot token

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Fill in `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id_here
DISCORD_GUILD_ID=your_test_server_id_here
SPOTIFY_CLIENT_ID=optional_spotify_client_id
SPOTIFY_CLIENT_SECRET=optional_spotify_client_secret
```

4. Register slash commands:

```bash
npm run register
```

5. Start the bot:

```bash
npm start
```

## Discord Bot Settings

In the Discord Developer Portal, enable these bot permissions/invites:

- Scopes: `bot`, `applications.commands`
- Bot permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`, `Read Message History`
- Bot privileged gateway intents: enable `Message Content Intent` if you want to use `!play` commands.

## Commands

Text commands, recommended if slash commands show `Application did not respond`:

- `!play song or url`
- `!p song or url`
- `!skip`
- `!stop`
- `!pause`
- `!resume`
- `!queue`
- `!nowplaying`
- `!np`

Slash commands:

- `/play query:<song or url>`
- `/skip`
- `/stop`
- `/pause`
- `/resume`
- `/queue`
- `/nowplaying`
# Я насрал
