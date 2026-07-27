import {
  CategoryChannel,
  Guild,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";

import { config } from "./config";
import {
  resolveGuestRoleForGuild,
  resolveVerifiedRoleForGuild,
} from "./verified-role";

function getProtectedCategoryIds() {
  return config.POKEGLORY_PROTECTED_CATEGORY_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getGuestGracePeriodMs() {
  const parsed = Number(config.POKEGLORY_GUEST_GRACE_PERIOD_MS);

  if (!Number.isFinite(parsed)) {
    return 30 * 60 * 1000;
  }

  return Math.min(Math.max(parsed, 5 * 60 * 1000), 24 * 60 * 60 * 1000);
}

export function isDiscordStaffMember(member: GuildMember) {
  return (
    member.id === member.guild.ownerId ||
    member.permissions.any([
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ModerateMembers,
    ])
  );
}

async function configureProtectedCategory(
  category: CategoryChannel,
  verifiedRoleId: string,
  guestRoleId: string,
  lobbyChannelId: string | undefined
) {
  const protectedOverwrites = [
    category.permissionOverwrites.edit(category.guild.roles.everyone, {
      ViewChannel: false,
    }),
    category.permissionOverwrites.edit(verifiedRoleId, {
      ViewChannel: true,
    }),
    category.permissionOverwrites.edit(guestRoleId, {
      ViewChannel: false,
    }),
  ];

  await Promise.all(protectedOverwrites);

  for (const channel of category.children.cache.values()) {
    if (channel.id === lobbyChannelId) {
      continue;
    }

    await Promise.all([
      channel.permissionOverwrites.edit(category.guild.roles.everyone, {
        ViewChannel: false,
      }),
      channel.permissionOverwrites.edit(verifiedRoleId, {
        ViewChannel: true,
      }),
      channel.permissionOverwrites.edit(guestRoleId, {
        ViewChannel: false,
      }),
    ]);
  }
}

export async function configureGuildAccess(guild: Guild) {
  const [verifiedRole, guestRole] = await Promise.all([
    resolveVerifiedRoleForGuild(guild),
    resolveGuestRoleForGuild(guild),
  ]);

  if (!verifiedRole || !guestRole) {
    throw new Error(
      "Nie znaleziono ról Discord wymaganych do ochrony serwera."
    );
  }

  for (const categoryId of getProtectedCategoryIds()) {
    const category = await guild.channels.fetch(categoryId).catch(() => null);

    if (!(category instanceof CategoryChannel)) {
      console.warn(
        `Nie znaleziono chronionej kategorii Discord: ${categoryId}`
      );
      continue;
    }

    await configureProtectedCategory(
      category,
      verifiedRole.id,
      guestRole.id,
      config.POKEGLORY_WELCOME_CHANNEL_ID
    );
  }

  if (config.POKEGLORY_WELCOME_CHANNEL_ID) {
    const lobby = await guild.channels
      .fetch(config.POKEGLORY_WELCOME_CHANNEL_ID)
      .catch(() => null);

    if (lobby && "permissionOverwrites" in lobby) {
      await Promise.all([
        lobby.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: true,
          ReadMessageHistory: true,
          UseApplicationCommands: true,
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          SendMessagesInThreads: false,
        }),
        lobby.permissionOverwrites.edit(guestRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          UseApplicationCommands: true,
          SendMessages: false,
        }),
        lobby.permissionOverwrites.edit(verifiedRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          UseApplicationCommands: true,
          SendMessages: false,
        }),
      ]);
    }
  }
}

export async function removeExpiredUnlinkedMembers(
  guild: Guild,
  linkedDiscordIds: Set<string>
) {
  const cutoff = Date.now() - getGuestGracePeriodMs();
  let removedCount = 0;

  for (const member of guild.members.cache.values()) {
    if (
      member.user.bot ||
      linkedDiscordIds.has(member.id) ||
      isDiscordStaffMember(member) ||
      !member.joinedTimestamp ||
      member.joinedTimestamp > cutoff ||
      !member.kickable
    ) {
      continue;
    }

    await member.kick(
      "Nie połączono konta Discord z kontem PokeGlory w wymaganym czasie."
    );
    removedCount += 1;
  }

  if (removedCount > 0) {
    console.log(`Usunięto niezweryfikowane konta Discord: ${removedCount}.`);
  }
}
