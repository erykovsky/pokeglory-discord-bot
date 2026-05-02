import { Client, EmbedBuilder, escapeMarkdown, TextChannel } from "discord.js";

import { config } from "./config";

type GameUpdate = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  authorNick: string | null;
};

type GameUpdatesResponse = {
  ok?: boolean;
  updates?: GameUpdate[];
  message?: string;
};

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_UPDATES_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.min(Math.max(parsed, 2000), 60000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

export async function resolveGameUpdatesChannel(client: Client) {
  if (config.POKEGLORY_UPDATES_CHANNEL_ID) {
    const channel = await client.channels.fetch(
      config.POKEGLORY_UPDATES_CHANNEL_ID,
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_UPDATES_CHANNEL_NAME,
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

async function fetchGameUpdates() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/game-updates`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    },
  );

  const result = (await response.json().catch(() => null)) as
    | GameUpdatesResponse
    | null;

  if (!response.ok || !result?.ok || !Array.isArray(result.updates)) {
    throw new Error(
      result?.message ?? `Game updates endpoint returned ${response.status}`,
    );
  }

  return result.updates;
}

function buildUpdateKey(update: Pick<GameUpdate, "title" | "createdAt">) {
  const timestamp = new Date(update.createdAt).toISOString();
  return `${update.title.trim()}|${timestamp}`;
}

function readUpdateKeyFromEmbed(embed: { title: string | null; timestamp: string | null }) {
  if (!embed.title || !embed.timestamp) {
    return null;
  }

  return `${embed.title.trim()}|${new Date(embed.timestamp).toISOString()}`;
}

function buildUpdateEmbed(update: GameUpdate) {
  const createdAt = new Date(update.createdAt);
  const embed = new EmbedBuilder()
    .setColor(0x38bdf8)
    .setTitle(escapeMarkdown(update.title).slice(0, 256))
    .setDescription(escapeMarkdown(update.content).slice(0, 4096));

  if (!Number.isNaN(createdAt.getTime())) {
    embed.setTimestamp(createdAt);
  }

  if (update.authorNick) {
    embed.setFooter({
      text: `PokeGlory • ${update.authorNick}`,
    });
  } else {
    embed.setFooter({
      text: "PokeGlory",
    });
  }

  return embed;
}

async function readExistingUpdateKeys(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });
  const keys = new Set<string>();

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    const embed = message.embeds[0];
    const key = embed
      ? readUpdateKeyFromEmbed({
          title: embed.title,
          timestamp: embed.timestamp,
        })
      : null;

    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

async function syncGameUpdatesMirror(client: Client) {
  const channel = await resolveGameUpdatesChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_UPDATES_CHANNEL_NAME}`,
    );
    return;
  }

  const [updates, existingKeys] = await Promise.all([
    fetchGameUpdates(),
    readExistingUpdateKeys(channel),
  ]);

  for (const update of updates) {
    const key = buildUpdateKey(update);

    if (existingKeys.has(key)) {
      continue;
    }

    await channel.send({
      embeds: [buildUpdateEmbed(update)],
    });
    existingKeys.add(key);
  }
}

export function startGameUpdatesMirror(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncGameUpdatesMirror(client);
    } catch (error) {
      console.error("Error syncing game updates mirror:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
