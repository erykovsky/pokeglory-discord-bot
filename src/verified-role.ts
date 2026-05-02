import {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";

import { config } from "./config";

async function resolveManagedRoleForGuild({
  guild,
  roleId,
  roleName,
  color,
  reason,
}: {
  guild: Guild;
  roleId?: string;
  roleName?: string;
  color: number;
  reason: string;
}) {
  if (roleId) {
    const role = await guild.roles.fetch(roleId).catch(() => null);

    if (role) {
      return role;
    }
  }

  const normalizedRoleName = roleName?.trim();

  if (!normalizedRoleName) {
    return null;
  }

  const roles = await guild.roles.fetch();
  const existingRole = roles.find((role) => role.name === normalizedRoleName);

  if (existingRole) {
    return existingRole;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.warn(
      `Brak uprawnienia ManageRoles do utworzenia roli Discord: ${normalizedRoleName}`,
    );
    return null;
  }

  return await guild.roles.create({
    name: normalizedRoleName,
    color,
    reason,
  });
}

export async function resolveGuestRoleForGuild(guild: Guild) {
  return await resolveManagedRoleForGuild({
    guild,
    roleId: config.POKEGLORY_GUEST_ROLE_ID,
    roleName: config.POKEGLORY_GUEST_ROLE_NAME,
    color: 0xa8b3c7,
    reason: "Rola dla nowych osób na serwerze PokeGlory.",
  });
}

export async function resolveVerifiedRoleForGuild(guild: Guild) {
  return await resolveManagedRoleForGuild({
    guild,
    roleId: config.POKEGLORY_VERIFIED_ROLE_ID,
    roleName: config.POKEGLORY_VERIFIED_ROLE_NAME,
    color: 0x78adff,
    reason: "Rola dla kont PokeGlory połączonych z Discordem.",
  });
}

export async function assignGuestRoleToMember(member: GuildMember) {
  const role = await resolveGuestRoleForGuild(member.guild);

  if (!role) {
    return false;
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, "Osoba dołączyła do serwera PokeGlory.");
  }

  return true;
}

export async function removeGuestRoleFromMember(member: GuildMember) {
  const role = await resolveGuestRoleForGuild(member.guild);

  if (!role || !member.roles.cache.has(role.id)) {
    return false;
  }

  await member.roles.remove(role, "Konto PokeGlory zostało połączone.");
  return true;
}

export async function assignVerifiedRoleToMember(member: GuildMember) {
  const role = await resolveVerifiedRoleForGuild(member.guild);

  if (!role) {
    return false;
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, "Konto PokeGlory połączone z Discordem.");
  }

  await removeGuestRoleFromMember(member);

  return true;
}

export async function assignVerifiedRole(
  interaction: ChatInputCommandInteraction,
) {
  const guild = interaction.guild;

  if (!guild) {
    return false;
  }

  try {
    const member = await guild.members.fetch(interaction.user.id);

    if (!(member instanceof GuildMember)) {
      return false;
    }

    return await assignVerifiedRoleToMember(member);
  } catch (error) {
    console.error("Error assigning verified Discord role:", error);
    return false;
  }
}
