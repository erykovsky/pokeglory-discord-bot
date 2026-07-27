import { EmbedBuilder, GuildMember, TextChannel } from "discord.js";

import { config } from "./config";
import { assignGuestRoleToMember } from "./verified-role";

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

async function resolveWelcomeChannel(member: GuildMember) {
  if (config.POKEGLORY_WELCOME_CHANNEL_ID) {
    const channel = await member.guild.channels.fetch(
      config.POKEGLORY_WELCOME_CHANNEL_ID
    );

    return channel?.isTextBased() ? (channel as TextChannel) : null;
  }

  const expectedName = normalizeDiscordChannelName(
    config.POKEGLORY_WELCOME_CHANNEL_NAME
  );
  const channels = await member.guild.channels.fetch();
  const channel = channels.find(
    (entry) =>
      entry?.isTextBased() &&
      normalizeDiscordChannelName(entry.name) === expectedName
  );

  return channel?.isTextBased() ? (channel as TextChannel) : null;
}

function formatJoinedAt(date: Date) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildWelcomeEmbed(member: GuildMember) {
  const displayName = member.displayName || member.user.username;

  return new EmbedBuilder()
    .setColor(0x78adff)
    .setAuthor({
      name: displayName,
      iconURL: member.user.displayAvatarURL({ size: 128 }),
    })
    .setDescription(
      `${member} właśnie wylądował(a). — ${formatJoinedAt(
        new Date()
      )}\n\nPołącz konto w ciągu **30 minut**. W grze otwórz **Ustawienia → Konto → Połączenie z Discordem**, wygeneruj kod i wpisz tutaj **/link**. Do czasu weryfikacji widzisz tylko lobby.`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
}

export async function sendWelcomeMessage(member: GuildMember) {
  try {
    await assignGuestRoleToMember(member);

    const channel = await resolveWelcomeChannel(member);

    if (!channel) {
      console.warn(
        `Nie znaleziono kanału Discord: ${config.POKEGLORY_WELCOME_CHANNEL_NAME}`
      );
      return;
    }

    await channel.send({
      embeds: [buildWelcomeEmbed(member)],
    });
  } catch (error) {
    console.error("Error sending welcome message:", error);
  }
}
