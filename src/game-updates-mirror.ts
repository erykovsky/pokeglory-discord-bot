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

type GameUpdatesMirrorKind = "game-updates" | "admin-announcements";

type GameUpdatesMirrorConfig = {
  kind: GameUpdatesMirrorKind;
  channelId?: string;
  channelName: string;
  syncIntervalMs: string;
  color: number;
  missingChannelLabel: string;
  errorLabel: string;
};

const missingChannelWarnings = new Map<string, number>();

function getSyncIntervalMs(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.min(Math.max(parsed, 2000), 60000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

async function resolveTextChannel(
  client: Client,
  channelId: string | undefined,
  channelName: string,
) {
  if (channelId) {
    const channel = await client.channels.fetch(channelId);

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(channelName);

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

export async function resolveGameUpdatesChannel(client: Client) {
  return resolveTextChannel(
    client,
    config.POKEGLORY_UPDATES_CHANNEL_ID,
    config.POKEGLORY_UPDATES_CHANNEL_NAME,
  );
}

export async function resolveAdminAnnouncementsChannel(client: Client) {
  return resolveTextChannel(
    client,
    config.POKEGLORY_ADMIN_ANNOUNCEMENTS_CHANNEL_ID,
    config.POKEGLORY_ADMIN_ANNOUNCEMENTS_CHANNEL_NAME,
  );
}

async function fetchGameUpdates(kind: GameUpdatesMirrorKind) {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const url = new URL(
    `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/game-updates`,
  );

  if (kind === "admin-announcements") {
    url.searchParams.set("kind", "admin-announcements");
  }

  const response = await fetch(url, {
    headers: {
      "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
    },
  });

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

function readUpdateKeyFromEmbed(embed: {
  title: string | null;
  timestamp: string | null;
}) {
  if (!embed.title || !embed.timestamp) {
    return null;
  }

  return `${embed.title.trim()}|${new Date(embed.timestamp).toISOString()}`;
}

function buildUpdateEmbed(update: GameUpdate, mirror: GameUpdatesMirrorConfig) {
  const createdAt = new Date(update.createdAt);
  const embed = new EmbedBuilder()
    .setColor(mirror.color)
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

function warnMissingChannel(channelName: string) {
  const now = Date.now();
  const lastWarningAt = missingChannelWarnings.get(channelName) ?? 0;

  if (now - lastWarningAt < 60000) {
    return;
  }

  missingChannelWarnings.set(channelName, now);
  console.warn(`Nie znaleziono kanału Discord: ${channelName}`);
}

async function syncGameUpdatesMirror(
  client: Client,
  mirror: GameUpdatesMirrorConfig,
) {
  const channel = await resolveTextChannel(
    client,
    mirror.channelId,
    mirror.channelName,
  );

  if (!channel) {
    warnMissingChannel(mirror.channelName);
    return;
  }

  const [updates, existingKeys] = await Promise.all([
    fetchGameUpdates(mirror.kind),
    readExistingUpdateKeys(channel),
  ]);

  for (const update of updates) {
    const key = buildUpdateKey(update);

    if (existingKeys.has(key)) {
      continue;
    }

    await channel.send({
      embeds: [buildUpdateEmbed(update, mirror)],
    });
    existingKeys.add(key);
  }
}

function startSingleGameUpdatesMirror(
  client: Client,
  mirror: GameUpdatesMirrorConfig,
) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncGameUpdatesMirror(client, mirror);
    } catch (error) {
      console.error(mirror.errorLabel, error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs(mirror.syncIntervalMs));
}

export function startGameUpdatesMirror(client: Client) {
  startSingleGameUpdatesMirror(client, {
    kind: "game-updates",
    channelId: config.POKEGLORY_UPDATES_CHANNEL_ID,
    channelName: config.POKEGLORY_UPDATES_CHANNEL_NAME,
    syncIntervalMs: config.POKEGLORY_UPDATES_SYNC_INTERVAL_MS,
    color: 0x38bdf8,
    missingChannelLabel: "aktualizacji",
    errorLabel: "Error syncing game updates mirror:",
  });

  startSingleGameUpdatesMirror(client, {
    kind: "admin-announcements",
    channelId: config.POKEGLORY_ADMIN_ANNOUNCEMENTS_CHANNEL_ID,
    channelName: config.POKEGLORY_ADMIN_ANNOUNCEMENTS_CHANNEL_NAME,
    syncIntervalMs: config.POKEGLORY_ADMIN_ANNOUNCEMENTS_SYNC_INTERVAL_MS,
    color: 0xf59e0b,
    missingChannelLabel: "ogłoszeń",
    errorLabel: "Error syncing admin announcements mirror:",
  });
}
