import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";

import { config } from "./config";

async function resolveVerifiedRole(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;

  if (!guild) {
    return null;
  }

  if (config.POKEGLORY_VERIFIED_ROLE_ID) {
    const role = await guild.roles
      .fetch(config.POKEGLORY_VERIFIED_ROLE_ID)
      .catch(() => null);

    if (role) {
      return role;
    }
  }

  const roleName = config.POKEGLORY_VERIFIED_ROLE_NAME?.trim();

  if (!roleName) {
    return null;
  }

  const roles = await guild.roles.fetch();
  const existingRole = roles.find((role) => role.name === roleName);

  if (existingRole) {
    return existingRole;
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.warn(
      `Brak uprawnienia ManageRoles do utworzenia roli Discord: ${roleName}`,
    );
    return null;
  }

  return await guild.roles.create({
    name: roleName,
    color: 0x78adff,
    reason: "Rola dla kont PokeGlory połączonych z Discordem.",
  });
}

export async function assignVerifiedRole(
  interaction: ChatInputCommandInteraction,
) {
  const guild = interaction.guild;

  if (!guild) {
    return false;
  }

  try {
    const [role, member] = await Promise.all([
      resolveVerifiedRole(interaction),
      guild.members.fetch(interaction.user.id),
    ]);

    if (!role || !(member instanceof GuildMember)) {
      return false;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(
        role,
        "Konto PokeGlory połączone z Discordem.",
      );
    }

    return true;
  } catch (error) {
    console.error("Error assigning verified Discord role:", error);
    return false;
  }
}
