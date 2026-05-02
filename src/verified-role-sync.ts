import { Client, Guild } from "discord.js";

import { config } from "./config";
import {
  assignVerifiedRoleToMember,
  assignGuestRoleToMember,
  resolveGuestRoleForGuild,
  resolveVerifiedRoleForGuild,
} from "./verified-role";

type LinkedAccountsResponse = {
  ok?: boolean;
  accounts?: string[];
  message?: string;
};

function getSyncIntervalMs() {
  const parsed = Number(config.POKEGLORY_ROLE_SYNC_INTERVAL_MS);

  if (!Number.isFinite(parsed)) {
    return 60000;
  }

  return Math.min(Math.max(parsed, 15000), 600000);
}

async function fetchLinkedDiscordIds() {
  if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
    throw new Error("Missing POKEGLORY_DISCORD_BOT_SECRET");
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/linked-accounts`,
    {
      headers: {
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
      },
    },
  );

  const result = (await response.json().catch(() => null)) as
    | LinkedAccountsResponse
    | null;

  if (!response.ok || !result?.ok || !Array.isArray(result.accounts)) {
    throw new Error(
      result?.message ?? `Linked accounts endpoint returned ${response.status}`,
    );
  }

  return new Set(result.accounts);
}

async function resolveSyncGuild(client: Client) {
  if (config.POKEGLORY_GUILD_ID) {
    return await client.guilds.fetch(config.POKEGLORY_GUILD_ID);
  }

  return client.guilds.cache.first() ?? null;
}

async function syncVerifiedRolesInGuild(guild: Guild, linkedDiscordIds: Set<string>) {
  const role = await resolveVerifiedRoleForGuild(guild);
  const guestRole = await resolveGuestRoleForGuild(guild);

  if (!role) {
    return;
  }

  await guild.members.fetch();

  for (const discordId of linkedDiscordIds) {
    const member = await guild.members.fetch(discordId).catch(() => null);

    if (member) {
      await assignVerifiedRoleToMember(member);
    }
  }

  const freshRole = await guild.roles.fetch(role.id);

  if (!freshRole) {
    return;
  }

  for (const member of freshRole.members.values()) {
    if (member.user.bot || linkedDiscordIds.has(member.id)) {
      continue;
    }

    await member.roles.remove(
      freshRole,
      "Konto PokeGlory zostało odłączone od Discorda.",
    );

    await assignGuestRoleToMember(member);
  }

  if (!guestRole) {
    return;
  }

  const freshGuestRole = await guild.roles.fetch(guestRole.id);

  if (!freshGuestRole) {
    return;
  }

  for (const member of freshGuestRole.members.values()) {
    if (member.user.bot || !linkedDiscordIds.has(member.id)) {
      continue;
    }

    await member.roles.remove(
      freshGuestRole,
      "Konto PokeGlory zostało połączone.",
    );
  }
}

async function syncVerifiedRoles(client: Client) {
  const guild = await resolveSyncGuild(client);

  if (!guild) {
    console.warn("Nie znaleziono serwera Discord do synchronizacji roli.");
    return;
  }

  const linkedDiscordIds = await fetchLinkedDiscordIds();
  await syncVerifiedRolesInGuild(guild, linkedDiscordIds);
}

export function startVerifiedRoleSync(client: Client) {
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) {
      return;
    }

    isSyncing = true;

    try {
      await syncVerifiedRoles(client);
    } catch (error) {
      console.error("Error syncing verified Discord roles:", error);
    } finally {
      isSyncing = false;
    }
  };

  void runSync();
  setInterval(() => {
    void runSync();
  }, getSyncIntervalMs());
}
