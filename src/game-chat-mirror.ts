import {
  Client,
  EmbedBuilder,
  escapeMarkdown,
  Message,
  TextChannel,
} from "discord.js";

import { config } from "./config";

const MIRROR_MESSAGE_COUNT = 10;
const MIRROR_FOOTER_PREFIX = "PokeGlory chat mirror";
const SLOT_FOOTER_PREFIX = "PokeGlory chat slot";
const EMPTY_CHAT_DESCRIPTION = "Brak wiadomości.";
const ORGANIZATION_AD_PREFIX = "ORG_AD|";

type GameChatMessage = {
  id: number;
  text: string;
  createdAt: string;
  author: {
    nick: string;
  } | null;
};

type GameChatResponse = {
  ok?: boolean;
  messages?: GameChatMessage[];
  message?: string;
};

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_GAME_CHAT_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 5000;
  }

  return Math.min(Math.max(parsed, 2000), 60000);
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

export async function resolveGameChatChannel(client: Client) {
  if (config.POKEGLORY_GAME_CHAT_CHANNEL_ID) {
    const channel = await client.channels.fetch(
      config.POKEGLORY_GAME_CHAT_CHANNEL_ID
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_GAME_CHAT_CHANNEL_NAME
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

function isLegacySlotMessage(message: Message) {
  const footerText = message.embeds[0]?.footer?.text;

  return Boolean(footerText?.startsWith(SLOT_FOOTER_PREFIX));
}

async function fetchGameChatMessages() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/chat-messages`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    }
  );

  const result = (await response
    .json()
    .catch(() => null)) as GameChatResponse | null;

  if (!response.ok || !result?.ok || !Array.isArray(result.messages)) {
    throw new Error(
      result?.message ?? `Game chat endpoint returned ${response.status}`
    );
  }

  return result.messages;
}

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Warsaw",
  });
}

function parseOrganizationAdvertisement(text: string) {
  if (!text.startsWith(ORGANIZATION_AD_PREFIX)) {
    return null;
  }

  const [, organizationSlug, organizationName, ...contentParts] =
    text.split("|");
  const content = contentParts.join("|").trim();
  const safeOrganizationName = organizationName?.trim();

  if (!safeOrganizationName || !content) {
    return null;
  }

  return {
    organizationSlug: organizationSlug?.trim() ?? "",
    organizationName: safeOrganizationName,
    content,
  };
}

function formatMessageText(message: GameChatMessage) {
  const organizationAdvertisement = parseOrganizationAdvertisement(
    message.text.trim()
  );

  if (!organizationAdvertisement) {
    return escapeMarkdown(message.text.trim() || EMPTY_CHAT_DESCRIPTION);
  }

  const organizationName = escapeMarkdown(
    organizationAdvertisement.organizationName
  );
  const content = escapeMarkdown(organizationAdvertisement.content);
  const organizationUrl = organizationAdvertisement.organizationSlug
    ? `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/organizacja/${encodeURIComponent(
        organizationAdvertisement.organizationSlug
      )}`
    : null;
  const organizationLine = organizationUrl
    ? `[${organizationName}](${organizationUrl})`
    : organizationName;

  return `**Reklama organizacji**\n${content}\n${organizationLine}`;
}

function formatMessageLine(message: GameChatMessage) {
  const authorName = escapeMarkdown(message.author?.nick ?? "System").slice(
    0,
    80
  );
  const time = formatMessageTime(message.createdAt);
  const text = formatMessageText(message);
  const header = time ? `**${authorName}** · ${time}` : `**${authorName}**`;

  return `${header}\n${text}`;
}

function buildChatEmbed(messages: GameChatMessage[]) {
  const description = messages.length
    ? messages.map(formatMessageLine).join("\n\n")
    : EMPTY_CHAT_DESCRIPTION;

  return new EmbedBuilder()
    .setColor(messages.length ? 0x3e7dd6 : 0x1d2f4f)
    .setTitle(`Czat w grze - ostatnie ${MIRROR_MESSAGE_COUNT} wiadomości`)
    .setDescription(description.slice(0, 4096))
    .setFooter({
      text: `${MIRROR_FOOTER_PREFIX} • odświeżany automatycznie`,
    });
}

async function readMirrorMessage(channel: TextChannel) {
  const fetchedMessages = await channel.messages.fetch({ limit: 100 });
  const mirrorMessages: Message[] = [];
  const duplicateMessages: Message[] = [];
  const legacySlotMessages: Message[] = [];

  for (const message of fetchedMessages.values()) {
    if (message.author.id !== channel.client.user?.id) {
      continue;
    }

    const footerText = message.embeds[0]?.footer?.text;

    if (footerText?.startsWith(MIRROR_FOOTER_PREFIX)) {
      mirrorMessages.push(message);
      continue;
    }

    if (isLegacySlotMessage(message)) {
      legacySlotMessages.push(message);
    }
  }

  const sortedMirrorMessages = mirrorMessages.sort(
    (left, right) => left.createdTimestamp - right.createdTimestamp
  );
  const primaryMessage = sortedMirrorMessages[0] ?? null;

  duplicateMessages.push(...sortedMirrorMessages.slice(1));

  for (const message of [...duplicateMessages, ...legacySlotMessages]) {
    if (message.deletable) {
      await message.delete().catch(() => undefined);
    }
  }

  return primaryMessage;
}

async function syncGameChatMirror(client: Client) {
  const channel = await resolveGameChatChannel(client);

  if (!channel) {
    console.warn(
      `Nie znaleziono kanału Discord: ${config.POKEGLORY_GAME_CHAT_CHANNEL_NAME}`
    );
    return;
  }

  const [gameMessages, existingMessage] = await Promise.all([
    fetchGameChatMessages(),
    readMirrorMessage(channel),
  ]);
  const embed = buildChatEmbed(gameMessages.slice(0, MIRROR_MESSAGE_COUNT));

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

export function startGameChatMirror(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncGameChatMirror(client);
    } catch (error) {
      console.error("Error syncing game chat mirror:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
