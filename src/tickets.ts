import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

import { config } from "./config";

const OPEN_TICKET_BUTTON_ID = "pokeglory-ticket:open";
const CLOSE_TICKET_BUTTON_ID = "pokeglory-ticket:close";
const TICKET_NAME_PREFIX = "blad";
const LEGACY_TICKET_NAME_PREFIX = "ticket";
const CLOSED_TICKET_NAME_PREFIX = "zamkniety";

let ticketCreationQueue = Promise.resolve();
let ticketSystemStarted = false;

function formatTicketNumber(value: number) {
  return value.toString().padStart(6, "0");
}

function getTicketTopic(input: {
  ticketNumber: number;
  ownerId: string;
  status: "open" | "closed";
}) {
  return [
    `ticket-id:${formatTicketNumber(input.ticketNumber)}`,
    `ticket-owner:${input.ownerId}`,
    `ticket-status:${input.status}`,
  ].join("; ");
}

function getTicketIdFromTopic(topic: string | null) {
  return topic?.match(/ticket-id:(\d+)/)?.[1] ?? null;
}

function getTicketOwnerIdFromTopic(topic: string | null) {
  return topic?.match(/ticket-owner:(\d{16,32})/)?.[1] ?? null;
}

function isTicketTextChannel(channel: unknown): channel is TextChannel {
  return (
    Boolean(channel) &&
    typeof channel === "object" &&
    "type" in channel &&
    channel.type === ChannelType.GuildText &&
    "topic" in channel &&
    typeof channel.topic === "string" &&
    channel.topic.includes("ticket-id:")
  );
}

function buildOpenTicketButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_TICKET_BUTTON_ID)
      .setLabel("Zgłoś błąd")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildCloseTicketButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_TICKET_BUTTON_ID)
      .setLabel("Zamknij zgłoszenie")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("Zgłaszanie błędów PokeGlory")
    .setDescription(
      [
        "Znalazłeś błąd w grze? Kliknij przycisk poniżej i dokładnie opisz problem.",
        "Utworzone zgłoszenie będzie widoczne tylko dla Ciebie oraz administratora gry.",
      ].join("\n")
    )
    .setColor(0xef4444);
}

function buildTicketWelcomeEmbed(ticketNumber: number, member: GuildMember) {
  return new EmbedBuilder()
    .setTitle(`Zgłoszenie błędu #${formatTicketNumber(ticketNumber)}`)
    .setDescription(
      [
        `${member}, opisz błąd i dodaj screen lub nagranie, jeśli je masz.`,
        "Administrator sprawdzi zgłoszenie, gdy będzie dostępny.",
      ].join("\n")
    )
    .setColor(0xef4444)
    .addFields(
      {
        name: "Zgłaszający",
        value: `${member} \`${member.id}\``,
        inline: false,
      },
      {
        name: "Status",
        value: "Oczekuje na sprawdzenie",
        inline: true,
      }
    )
    .setTimestamp();
}

async function enqueueTicketCreation<T>(task: () => Promise<T>) {
  const queuedTask = ticketCreationQueue.then(task, task);
  ticketCreationQueue = queuedTask.then(
    () => undefined,
    () => undefined
  );

  return queuedTask;
}

async function fetchTicketCategory(guild: Guild) {
  if (!config.DISCORD_TICKET_CATEGORY_ID) {
    throw new Error("Brak DISCORD_TICKET_CATEGORY_ID w konfiguracji bota.");
  }

  const category = await guild.channels.fetch(
    config.DISCORD_TICKET_CATEGORY_ID
  );

  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      "DISCORD_TICKET_CATEGORY_ID nie wskazuje na kategorię Discorda."
    );
  }

  return category;
}

async function fetchTicketChannels(guild: Guild) {
  await fetchTicketCategory(guild);
  const channels = await guild.channels.fetch();

  return channels.filter(
    (channel): channel is TextChannel =>
      Boolean(channel) &&
      channel.type === ChannelType.GuildText &&
      channel.parentId === config.DISCORD_TICKET_CATEGORY_ID
  );
}

async function findOpenTicketForMember(guild: Guild, memberId: string) {
  const channels = await fetchTicketChannels(guild);

  return (
    channels.find(
      (channel) =>
        channel.topic?.includes(`ticket-owner:${memberId}`) &&
        channel.topic.includes("ticket-status:open")
    ) ?? null
  );
}

async function getNextTicketNumber(guild: Guild) {
  const channels = await fetchTicketChannels(guild);
  const usedTicketNumbers = new Set<number>();

  for (const channel of channels.values()) {
    const match = channel.name.match(
      new RegExp(
        `^(?:${TICKET_NAME_PREFIX}|${LEGACY_TICKET_NAME_PREFIX}|${CLOSED_TICKET_NAME_PREFIX})-(\\d+)$`
      )
    );
    const ticketNumber = match ? Number(match[1]) : Number.NaN;

    if (Number.isInteger(ticketNumber) && ticketNumber > 0) {
      usedTicketNumbers.add(ticketNumber);
    }
  }

  let nextTicketNumber = 1;

  while (usedTicketNumbers.has(nextTicketNumber)) {
    nextTicketNumber += 1;
  }

  return nextTicketNumber;
}

async function createTicketChannel(interaction: ButtonInteraction) {
  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply(
      "Zgłoszenia działają tylko na serwerze Discord."
    );
    return;
  }

  const member = await guild.members.fetch(interaction.user.id);
  const existingTicket = await findOpenTicketForMember(guild, member.id);

  if (existingTicket) {
    await interaction.editReply(
      `Masz już otwarte zgłoszenie: ${existingTicket}.`
    );
    return;
  }

  const ticketNumber = await getNextTicketNumber(guild);
  const formattedTicketNumber = formatTicketNumber(ticketNumber);
  const botUserId = interaction.client.user?.id;

  if (!botUserId) {
    await interaction.editReply("Bot nie jest jeszcze gotowy.");
    return;
  }

  const ticketChannel = await guild.channels.create({
    name: `${TICKET_NAME_PREFIX}-${formattedTicketNumber}`,
    type: ChannelType.GuildText,
    parent: config.DISCORD_TICKET_CATEGORY_ID,
    topic: getTicketTopic({
      ticketNumber,
      ownerId: member.id,
      status: "open",
    }),
    reason: `Zgłoszenie błędu #${formattedTicketNumber} utworzone przez ${member.user.tag}.`,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
  });

  await ticketChannel.send({
    content: `Nowe zgłoszenie błędu od ${member}.`,
    allowedMentions: {
      users: [member.id],
    },
    embeds: [buildTicketWelcomeEmbed(ticketNumber, member)],
    components: [buildCloseTicketButton()],
  });

  await interaction.editReply(
    `Utworzono zgłoszenie #${formattedTicketNumber}: ${ticketChannel}.`
  );
}

async function closeTicketChannel(interaction: ButtonInteraction) {
  const channel = interaction.channel;
  const guild = interaction.guild;

  if (!guild || !isTicketTextChannel(channel)) {
    await interaction.editReply(
      "Ten przycisk działa tylko w kanale zgłoszenia."
    );
    return;
  }

  const member = await guild.members.fetch(interaction.user.id);
  const canCloseTicket = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  if (!canCloseTicket) {
    await interaction.editReply("Tylko administrator może zamknąć zgłoszenie.");
    return;
  }

  const ticketId = getTicketIdFromTopic(channel.topic);
  const ownerId = getTicketOwnerIdFromTopic(channel.topic);
  const formattedTicketId = ticketId ?? "000000";
  const nextTopic = channel.topic.replace(
    "ticket-status:open",
    "ticket-status:closed"
  );

  if (ownerId) {
    await channel.permissionOverwrites
      .edit(
        ownerId,
        {
          SendMessages: false,
          ViewChannel: true,
          ReadMessageHistory: true,
        },
        {
          reason: `Zgłoszenie #${formattedTicketId} zamknięte przez ${member.user.tag}.`,
        }
      )
      .catch(() => undefined);
  }

  await channel.setTopic(nextTopic).catch(() => undefined);
  await channel
    .setName(`${CLOSED_TICKET_NAME_PREFIX}-${formattedTicketId}`)
    .catch(() => undefined);

  await channel.send({
    content: `Zgłoszenie #${formattedTicketId} zostało zamknięte przez ${member}.`,
    allowedMentions: {
      users: [member.id],
    },
  });

  await interaction.editReply(`Zamknięto zgłoszenie #${formattedTicketId}.`);
}

export async function handleTicketInteraction(interaction: Interaction) {
  if (!interaction.isButton()) {
    return false;
  }

  if (interaction.customId === OPEN_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await enqueueTicketCreation(() => createTicketChannel(interaction));
    return true;
  }

  if (interaction.customId === CLOSE_TICKET_BUTTON_ID) {
    await interaction.deferReply({ ephemeral: true });
    await closeTicketChannel(interaction);
    return true;
  }

  return false;
}

export const ticketPanelCommand = {
  name: "ticket-panel",
  description: "Wysyła panel do tworzenia prywatnych zgłoszeń błędów.",
  default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: "Ta komenda działa tylko na serwerze Discord.",
        ephemeral: true,
      });
      return;
    }

    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: "Nie masz uprawnień do wysłania panelu zgłoszeń.",
        ephemeral: true,
      });
      return;
    }

    const targetChannelId =
      config.DISCORD_TICKET_PANEL_CHANNEL_ID ?? interaction.channelId;
    const targetChannel = await interaction.guild.channels.fetch(
      targetChannelId
    );

    if (
      !targetChannel ||
      targetChannel.type !== ChannelType.GuildText ||
      !targetChannel.isTextBased()
    ) {
      await interaction.reply({
        content:
          "DISCORD_TICKET_PANEL_CHANNEL_ID musi wskazywać zwykły kanał tekstowy.",
        ephemeral: true,
      });
      return;
    }

    await targetChannel.permissionOverwrites.edit(interaction.guild.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    });

    await targetChannel.send({
      embeds: [buildTicketPanelEmbed()],
      components: [buildOpenTicketButton()],
    });

    await interaction.reply({
      content: `Panel zgłoszeń błędów wysłany na ${targetChannel}.`,
      ephemeral: true,
    });
  },
};

export function startTicketSystem(client: Client) {
  if (ticketSystemStarted) {
    return;
  }

  ticketSystemStarted = true;

  if (!config.DISCORD_TICKET_CATEGORY_ID) {
    console.warn("[tickets] Brak DISCORD_TICKET_CATEGORY_ID.");
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleTicketInteraction(interaction);
    } catch (error) {
      console.error("[tickets] Nie udało się obsłużyć interakcji.", error);

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "Nie udało się obsłużyć zgłoszenia. Spróbuj ponownie za chwilę.",
          ephemeral: true,
        });
      } else if (interaction.isRepliable()) {
        await interaction
          .editReply(
            "Nie udało się obsłużyć zgłoszenia. Spróbuj ponownie za chwilę."
          )
          .catch(() => undefined);
      }
    }
  });
}
