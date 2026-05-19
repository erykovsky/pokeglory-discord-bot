import {
  Client,
  EmbedBuilder,
  escapeMarkdown,
  Message,
  TextChannel,
} from "discord.js";

import { config } from "./config";

const ORGANIZATION_RANKING_FOOTER_PREFIX = "PokeGlory ranking organizacji";
const RANKING_LIMIT = 25;

type OrganizationRankingEntry = {
  rank: number;
  name: string;
  tag: string;
  memberCount: number;
  memberLimit: number;
  totalPoints: number;
};

type OrganizationRankingResponse = {
  ok?: boolean;
  ranking?: {
    entries: OrganizationRankingEntry[];
    totalOrganizations: number;
    generatedAt: string;
  };
  message?: string;
};

const numberFormatter = new Intl.NumberFormat("pl-PL");

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_ORGANIZATION_RANKING_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 300000;
  }

  return Math.min(Math.max(parsed, 60000), 3600000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

export async function resolveOrganizationRankingChannel(client: Client) {
  if (config.POKEGLORY_ORGANIZATION_RANKING_CHANNEL_ID) {
    const channel = await client.channels.fetch(
      config.POKEGLORY_ORGANIZATION_RANKING_CHANNEL_ID
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_ORGANIZATION_RANKING_CHANNEL_NAME
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

async function fetchOrganizationRanking() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(
      /\/$/,
      ""
    )}/api/discord/organization-ranking?limit=${RANKING_LIMIT}`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    }
  );

  const result = (await response
    .json()
    .catch(() => null)) as OrganizationRankingResponse | null;

  if (!response.ok || !result?.ok || !result.ranking) {
    throw new Error(
      result?.message ?? `Organization ranking endpoint returned ${response.status}`
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

function formatRankingLine(entry: OrganizationRankingEntry) {
  const medal =
    entry.rank === 1
      ? "🥇"
      : entry.rank === 2
      ? "🥈"
      : entry.rank === 3
      ? "🥉"
      : `#${entry.rank}`;
  const name = escapeMarkdown(entry.name).slice(0, 80);
  const tag = escapeMarkdown(entry.tag).slice(0, 20);
  const points = numberFormatter.format(entry.totalPoints);
  const memberCount = numberFormatter.format(entry.memberCount);
  const memberLimit = numberFormatter.format(entry.memberLimit);

  return `${medal} **[${tag}] ${name}** · ${points} pkt · ${memberCount}/${memberLimit} członków`;
}

function buildRankingEmbed(
  ranking: NonNullable<OrganizationRankingResponse["ranking"]>
) {
  const generatedAt = formatGeneratedAt(ranking.generatedAt);
  const description = ranking.entries.length
    ? ranking.entries.map(formatRankingLine).join("\n")
    : "Ranking organizacji jest jeszcze pusty.";

  const embed = new EmbedBuilder()
    .setColor(0x38bdf8)
    .setTitle(`Ranking organizacji TOP ${RANKING_LIMIT}`)
    .setDescription(description.slice(0, 4096))
    .setFooter({
      text: generatedAt
        ? `${ORGANIZATION_RANKING_FOOTER_PREFIX} • Organizacje: ${numberFormatter.format(
            ranking.totalOrganizations
          )} • ${generatedAt}`
        : `${ORGANIZATION_RANKING_FOOTER_PREFIX} • Organizacje: ${numberFormatter.format(
            ranking.totalOrganizations
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

    if (
      message.embeds[0]?.footer?.text?.startsWith(
        ORGANIZATION_RANKING_FOOTER_PREFIX
      )
    ) {
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

async function syncOrganizationRankingMirror(client: Client) {
  const channel = await resolveOrganizationRankingChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_ORGANIZATION_RANKING_CHANNEL_NAME}`
    );
    return;
  }

  const [ranking, existingMessage] = await Promise.all([
    fetchOrganizationRanking(),
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

export function startOrganizationRankingMirror(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncOrganizationRankingMirror(client);
    } catch (error) {
      console.error("Error syncing organization ranking mirror:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
