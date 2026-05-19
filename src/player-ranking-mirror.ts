import {
  Client,
  EmbedBuilder,
  escapeMarkdown,
  Message,
  TextChannel,
} from "discord.js";

import { config } from "./config";

const RANKING_FOOTER_PREFIX = "PokeGlory ranking";
const RANKING_LIMIT = 25;

type PlayerRankingEntry = {
  rank: number;
  nick: string;
  organization?: { tag?: string | null } | null;
  level: number;
  pokemonCount: number;
  totalPokemonValue: number;
  totalItemValue?: number;
  totalRankingValue?: number;
  points: number;
};

type PlayerRankingResponse = {
  ok?: boolean;
  ranking?: {
    entries: PlayerRankingEntry[];
    totalPlayers: number;
    generatedAt: string;
  };
  message?: string;
};

const numberFormatter = new Intl.NumberFormat("pl-PL");

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_RANKING_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 300000;
  }

  return Math.min(Math.max(parsed, 60000), 3600000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

export async function resolvePlayerRankingChannel(client: Client) {
  if (config.POKEGLORY_RANKING_CHANNEL_ID) {
    const channel = await client.channels.fetch(
      config.POKEGLORY_RANKING_CHANNEL_ID
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_RANKING_CHANNEL_NAME
  );

  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch();
    const channel = channels.find(
      (entry) =>
        entry?.isTextBased() &&
        normalizeDiscordChannelName(entry.name) === expectedName
    );

    if (channel?.isTextBased()) {
      return channel as TextChannel;
    }
  }

  return null;
}

async function fetchPlayerRanking() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(
      /\/$/,
      ""
    )}/api/discord/ranking?limit=${RANKING_LIMIT}`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    }
  );

  const result = (await response
    .json()
    .catch(() => null)) as PlayerRankingResponse | null;

  if (!response.ok || !result?.ok || !result.ranking) {
    throw new Error(
      result?.message ?? `Ranking endpoint returned ${response.status}`
    );
  }

  return result.ranking;
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Warsaw",
    year: "numeric",
  });
}

function formatRankingLine(entry: PlayerRankingEntry) {
  const medal =
    entry.rank === 1
      ? "🥇"
      : entry.rank === 2
      ? "🥈"
      : entry.rank === 3
      ? "🥉"
      : `#${entry.rank}`;
  const nickBase = escapeMarkdown(entry.nick).slice(0, 80);
  const organizationTag = entry.organization?.tag?.trim();
  const nick = organizationTag
    ? nickBase + " [" + escapeMarkdown(organizationTag).slice(0, 16) + "]"
    : nickBase;
  const points = numberFormatter.format(entry.points);
  const totalPokemonValue = numberFormatter.format(entry.totalPokemonValue);
  const totalItemValue = numberFormatter.format(entry.totalItemValue ?? 0);
  const totalRankingValue = numberFormatter.format(
    entry.totalRankingValue ??
      entry.totalPokemonValue + (entry.totalItemValue ?? 0)
  );
  const pokemonCount = numberFormatter.format(entry.pokemonCount);

  return `${medal} **${nick}** · ${points} pkt · lvl ${entry.level} · ${pokemonCount} Pokémonów · razem ${totalRankingValue} ¥ · Pokémony ${totalPokemonValue} ¥ · przedmioty ${totalItemValue} ¥`;
}

function buildRankingEmbed(
  ranking: NonNullable<PlayerRankingResponse["ranking"]>
) {
  const generatedAt = formatGeneratedAt(ranking.generatedAt);
  const description = ranking.entries.length
    ? ranking.entries.map(formatRankingLine).join("\n")
    : "Ranking jest jeszcze pusty.";

  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle(`Ranking graczy TOP ${RANKING_LIMIT}`)
    .setDescription(description.slice(0, 4096))
    .setFooter({
      text: generatedAt
        ? `${RANKING_FOOTER_PREFIX} • Graczy: ${numberFormatter.format(
            ranking.totalPlayers
          )} • ${generatedAt}`
        : `${RANKING_FOOTER_PREFIX} • Graczy: ${numberFormatter.format(
            ranking.totalPlayers
          )}`,
    });

  return embed;
}

async function readRankingMirrorMessages(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 50 });
  const rankingMessages: Message[] = [];

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    if (message.embeds[0]?.footer?.text?.startsWith(RANKING_FOOTER_PREFIX)) {
      rankingMessages.push(message);
    }
  }

  const sortedRankingMessages = rankingMessages.sort(
    (left, right) => left.createdTimestamp - right.createdTimestamp
  );
  const primaryMessage = sortedRankingMessages[0] ?? null;
  const duplicateMessages = sortedRankingMessages.slice(1);

  for (const message of duplicateMessages) {
    if (message.deletable) {
      await message.delete().catch(() => undefined);
    }
  }

  return primaryMessage;
}

async function syncPlayerRankingMirror(client: Client) {
  const channel = await resolvePlayerRankingChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_RANKING_CHANNEL_NAME}`
    );
    return;
  }

  const [ranking, existingMessage] = await Promise.all([
    fetchPlayerRanking(),
    readRankingMirrorMessages(channel),
  ]);
  const embed = buildRankingEmbed(ranking);

  if (existingMessage) {
    await existingMessage.edit({
      content: "",
      embeds: [embed],
    });
    return;
  }

  await channel.send({
    embeds: [embed],
  });
}

export function startPlayerRankingMirror(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncPlayerRankingMirror(client);
    } catch (error) {
      console.error("Error syncing player ranking mirror:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
