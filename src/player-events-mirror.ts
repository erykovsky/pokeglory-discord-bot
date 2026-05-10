import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
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

type PlayerEventsState = {
  lastSentEventId: number;
};

const PLAYER_EVENTS_STATE_FILE =
  process.env.POKEGLORY_PLAYER_EVENTS_STATE_FILE?.trim() ||
  "/app/data/player-events-state.json";

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

function readPlayerEventsState() {
  if (!existsSync(PLAYER_EVENTS_STATE_FILE)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(PLAYER_EVENTS_STATE_FILE, "utf8"),
    ) as Partial<PlayerEventsState>;
    const lastSentEventId = Number(parsed.lastSentEventId);

    return Number.isFinite(lastSentEventId) && lastSentEventId >= 0
      ? { lastSentEventId }
      : null;
  } catch (error) {
    console.warn("Nie udało się odczytać stanu wydarzeń graczy:", error);
    return null;
  }
}

function writePlayerEventsState(state: PlayerEventsState) {
  mkdirSync(dirname(PLAYER_EVENTS_STATE_FILE), { recursive: true });
  writeFileSync(PLAYER_EVENTS_STATE_FILE, JSON.stringify(state, null, 2));
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

function buildAbsolutePokeGloryUrl(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${config.POKEGLORY_API_URL.replace(/\/$/, "")}${value}`;
  }

  return null;
}

function buildPlayerEventDescription(event: PlayerEvent) {
  if (event.type === "shiny_wild_encounter") {
    const pokemonName =
      getStringMetadata(event, "pokemonName") ?? "shiny Pokémona";
    const locationName = getStringMetadata(event, "locationName");
    const authorNick = event.authorNick?.trim() || "Gracz";

    return locationName
      ? `${authorNick} spotkał/a ${pokemonName} w lokacji ${locationName}.`
      : `${authorNick} spotkał/a ${pokemonName}.`;
  }

  return event.content;
}

function buildPlayerEventEmbed(event: PlayerEvent) {
  const createdAt = new Date(event.createdAt);
  const imageUrl = buildAbsolutePokeGloryUrl(
    getStringMetadata(event, "imageUrl"),
  );
  const title = buildPlayerEventTitle(event);
  const description = buildPlayerEventDescription(event);

  const embed = new EmbedBuilder()
    .setColor(event.type === "player_level_up" ? 0x60a5fa : 0xfacc15)
    .setTitle(title.slice(0, 256))
    .setDescription(escapeMarkdown(description).slice(0, 4096));

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  if (!Number.isNaN(createdAt.getTime())) {
    embed.setTimestamp(createdAt);
  }

  return embed;
}

async function syncPlayerEventsMirror(client: Client) {
  const channel = await resolvePlayerEventsChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_PLAYER_EVENTS_CHANNEL_NAME}`,
    );
    return;
  }

  const events = await fetchPlayerEvents();

  if (events.length === 0) {
    return;
  }

  const state = readPlayerEventsState();
  const sortedEvents = [...events].sort((a, b) => a.id - b.id);

  if (!state) {
    const latestEventId = Math.max(...sortedEvents.map((event) => event.id));
    writePlayerEventsState({ lastSentEventId: latestEventId });
    console.log(
      `Zainicjowano stan wydarzeń graczy od eventu #${latestEventId}.`,
    );
    return;
  }

  let lastSentEventId = state.lastSentEventId;

  for (const event of sortedEvents) {
    if (event.id <= lastSentEventId) {
      continue;
    }

    await channel.send({
      embeds: [buildPlayerEventEmbed(event)],
    });
    lastSentEventId = event.id;
    writePlayerEventsState({ lastSentEventId });
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
