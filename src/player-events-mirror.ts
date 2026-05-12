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
    `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/game-updates?kind=player-events`,
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

function buildEventKey(event: Pick<PlayerEvent, "id" | "type">) {
  return `${event.type}:${event.id}`;
}

function readEventKeyFromEmbed(embed: { footer: { text: string | null } | null }) {
  const footerText = embed.footer?.text ?? "";
  const match = footerText.match(/#(\d+)$/);

  if (!match) {
    return null;
  }

  const typeMatch = footerText.match(/PokeGlory wydarzenia graczy • ([^•]+) • #/);

  if (!typeMatch) {
    return null;
  }

  return `${typeMatch[1]?.trim()}:${match[1]}`;
}

function getEventPresentation(event: PlayerEvent) {
  if (event.type === "shiny_pokemon_hatched") {
    return {
      color: 0xfacc15,
      title: `✨ ${event.title}`,
    };
  }

  if (event.type === "shiny_legendary_wild_encounter") {
    return {
      color: 0xf59e0b,
      title: `🌟 ${event.title}`,
    };
  }

  if (event.type === "shiny_wild_encounter") {
    return {
      color: 0xfacc15,
      title: `🌟 ${event.title}`,
    };
  }

  if (event.type === "legendary_wild_encounter") {
    return {
      color: 0x38bdf8,
      title: `🐉 ${event.title}`,
    };
  }

  if (event.type === "player_level_up") {
    return {
      color: 0x60a5fa,
      title: `⬆️ ${event.title}`,
    };
  }

  return {
    color: 0x94a3b8,
    title: event.title,
  };
}

function buildEventEmbed(event: PlayerEvent) {
  const createdAt = new Date(event.createdAt);
  const presentation = getEventPresentation(event);
  const imageUrl =
    typeof event.metadata.imageUrl === "string" ? event.metadata.imageUrl : null;
  const embed = new EmbedBuilder()
    .setColor(presentation.color)
    .setTitle(escapeMarkdown(presentation.title).slice(0, 256))
    .setDescription(escapeMarkdown(event.content).slice(0, 4096))
    .setFooter({
      text: `PokeGlory wydarzenia graczy • ${event.type} • #${event.id}`,
    });

  if (!Number.isNaN(createdAt.getTime())) {
    embed.setTimestamp(createdAt);
  }

  if (imageUrl) {
    embed.setThumbnail(
      imageUrl.startsWith("http")
        ? imageUrl
        : `${config.POKEGLORY_API_URL.replace(/\/$/, "")}${imageUrl}`,
    );
  }

  return embed;
}

async function readExistingEventKeys(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });
  const keys = new Set<string>();

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    const embed = message.embeds[0];
    const key = embed
      ? readEventKeyFromEmbed({
          footer: embed.footer,
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
    readExistingEventKeys(channel),
  ]);

  for (const event of events) {
    const key = buildEventKey(event);

    if (existingKeys.has(key)) {
      continue;
    }

    await channel.send({
      embeds: [buildEventEmbed(event)],
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
