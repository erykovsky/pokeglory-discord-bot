import { Client, EmbedBuilder, escapeMarkdown, TextChannel } from "discord.js";

import { config } from "./config";

const PLAYER_EVENT_MARKER_PREFIX = "<!-- pokeglory-player-event:";

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

function buildPlayerEventMessageContent(eventId: number) {
  return `${PLAYER_EVENT_MARKER_PREFIX}${eventId} -->`;
}

function readEventIdFromMessageContent(content: string | null | undefined) {
  const escapedPrefix = PLAYER_EVENT_MARKER_PREFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const match = content?.match(new RegExp(`${escapedPrefix}(\\d+) -->`));
  return match ? Number(match[1]) : null;
}

function getStringMetadata(event: PlayerEvent, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPlayerEventEmbed(event: PlayerEvent) {
  const createdAt = new Date(event.createdAt);
  const imageUrl = getStringMetadata(event, "imageUrl");
  const pokemonName = getStringMetadata(event, "pokemonName");
  const title = pokemonName ? `🌟 Shiny ${pokemonName}` : `🌟 ${event.title}`;

  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
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

async function readExistingPlayerEventIds(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });
  const ids = new Set<number>();

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    const eventId = readEventIdFromMessageContent(message.content);

    if (eventId !== null) {
      ids.add(eventId);
    }
  }

  return ids;
}

async function syncPlayerEventsMirror(client: Client) {
  const channel = await resolvePlayerEventsChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_PLAYER_EVENTS_CHANNEL_NAME}`,
    );
    return;
  }

  const [events, existingIds] = await Promise.all([
    fetchPlayerEvents(),
    readExistingPlayerEventIds(channel),
  ]);

  for (const event of events) {
    if (existingIds.has(event.id)) {
      continue;
    }

    await channel.send({
      content: buildPlayerEventMessageContent(event.id),
      embeds: [buildPlayerEventEmbed(event)],
    });
    existingIds.add(event.id);
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
