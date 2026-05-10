import { Client, EmbedBuilder, escapeMarkdown, TextChannel } from "discord.js";

import { config } from "./config";

type PlayerEvent = {
  id: number;
  type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  authorNick: string | null;
};

type PlayerEventsResponse = {
  ok?: boolean;
  updates?: PlayerEvent[];
  message?: string;
};

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_PLAYER_EVENTS_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.min(Math.max(parsed, 2000), 60000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

export async function resolvePlayerEventsChannel(client: Client) {
  if (config.POKEGLORY_PLAYER_EVENTS_CHANNEL_ID) {
    const channel = await client.channels.fetch(
      config.POKEGLORY_PLAYER_EVENTS_CHANNEL_ID,
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_PLAYER_EVENTS_CHANNEL_NAME,
  );

  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch();
    const channel = channels.find(
      (entry) =>
        entry?.isTextBased() &&
        normalizeDiscordChannelName(entry.name) === expectedName,
    );

    if (channel?.isTextBased()) {
      return channel as TextChannel;
    }
  }

  return null;
}

async function fetchPlayerEvents() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(
      /\/$/,
      "",
    )}/api/discord/game-updates?kind=player-events`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    },
  );

  const result = (await response.json().catch(() => null)) as
    | PlayerEventsResponse
    | null;

  if (!response.ok || !result?.ok || !Array.isArray(result.updates)) {
    throw new Error(
      result?.message ?? `Player events endpoint returned ${response.status}`,
    );
  }

  return result.updates;
}

function getStringMetadata(event: PlayerEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPlayerEventTitle(event: PlayerEvent) {
  const pokemonName = getStringMetadata(event, "pokemonName");

  if (event.type === "shiny_wild_encounter" && pokemonName) {
    return `🌟 Shiny ${pokemonName}`;
  }

  if (event.type === "player_level_up") {
    return "⬆️ Awans poziomu";
  }

  return `🌟 ${event.title}`;
}

function buildPlayerEventKey(event: PlayerEvent) {
  return `${buildPlayerEventTitle(event)}|${new Date(event.createdAt).toISOString()}`;
}

function readPlayerEventKeyFromEmbed(embed: {
  title: string | null;
  timestamp: string | null;
}) {
  if (!embed.title || !embed.timestamp) {
    return null;
  }

  return `${embed.title.trim()}|${new Date(embed.timestamp).toISOString()}`;
}

function buildPlayerEventEmbed(event: PlayerEvent) {
  const createdAt = new Date(event.createdAt);
  const imageUrl = getStringMetadata(event, "imageUrl");
  const title = buildPlayerEventTitle(event);

  const embed = new EmbedBuilder()
    .setColor(event.type === "player_level_up" ? 0x60a5fa : 0xfacc15)
    .setTitle(title.slice(0, 256))
    .setDescription(escapeMarkdown(event.content).slice(0, 4096));

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  if (!Number.isNaN(createdAt.getTime())) {
    embed.setTimestamp(createdAt);
  }

  return embed;
}

async function readExistingPlayerEventKeys(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });
  const keys = new Set<string>();

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    const key = message.embeds[0]
      ? readPlayerEventKeyFromEmbed({
          title: message.embeds[0].title,
          timestamp: message.embeds[0].timestamp,
        })
      : null;

    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

async function syncPlayerEventsMirror(client: Client) {
  const channel = await resolvePlayerEventsChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_PLAYER_EVENTS_CHANNEL_NAME}`,
    );
    return;
  }

  const [events, existingKeys] = await Promise.all([
    fetchPlayerEvents(),
    readExistingPlayerEventKeys(channel),
  ]);

  for (const event of events) {
    const key = buildPlayerEventKey(event);

    if (existingKeys.has(key)) {
      continue;
    }

    await channel.send({
      embeds: [buildPlayerEventEmbed(event)],
    });
    existingKeys.add(key);
  }
}

export function startPlayerEventsMirror(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncPlayerEventsMirror(client);
    } catch (error) {
      console.error("Error syncing player events mirror:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
