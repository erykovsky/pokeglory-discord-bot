import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

import { config } from "../config";
import { assignVerifiedRole } from "../verified-role";

type LinkedProfileApiResponse = {
  ok: true;
  linked: true;
  profile: {
    id: number;
    nick: string;
    level: number;
    experience: number;
    maxExperience: number;
    createdAt: string;
    organizationName: string | null;
    organizationTag: string | null;
  };
};

type ProfileApiResponse =
  | LinkedProfileApiResponse
  | {
      ok: true;
      linked: false;
      message?: string;
    }
  | {
      ok?: false;
      message?: string;
    };

const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const numberFormatter = new Intl.NumberFormat("pl-PL");

function formatOrganization(result: LinkedProfileApiResponse) {
  const { organizationName, organizationTag } = result.profile;

  if (!organizationName) {
    return "Brak";
  }

  return organizationTag
    ? `${organizationName} [${organizationTag}]`
    : organizationName;
}

function buildProfileEmbed(
  interaction: ChatInputCommandInteraction,
  result: Extract<ProfileApiResponse, { linked: true }>
) {
  const { profile } = result;
  const profileUrl = `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/profil/${
    profile.id
  }`;

  return new EmbedBuilder()
    .setColor(0x78adff)
    .setAuthor({
      name: profile.nick,
      iconURL: interaction.user.displayAvatarURL({ size: 128 }),
    })
    .setTitle("Profil PokeGlory")
    .setURL(profileUrl)
    .addFields(
      {
        name: "Nick",
        value: profile.nick,
        inline: true,
      },
      {
        name: "Poziom",
        value: numberFormatter.format(profile.level),
        inline: true,
      },
      {
        name: "EXP",
        value: `${numberFormatter.format(
          profile.experience
        )} / ${numberFormatter.format(profile.maxExperience)}`,
        inline: true,
      },
      {
        name: "Dołączył(a)",
        value: dateFormatter.format(new Date(profile.createdAt)),
        inline: true,
      },
      {
        name: "Organizacja",
        value: formatOrganization(result),
        inline: true,
      }
    );
}

const profilCommand = {
  name: "profil",
  description: "Pokaż swój profil PokeGlory.",
  async execute(interaction: ChatInputCommandInteraction) {
    if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
      await interaction.reply({
        content:
          "Integracja PokeGlory z Discordem nie jest jeszcze skonfigurowana.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const apiUrl = new URL(
        `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/profile`
      );
      apiUrl.searchParams.set("discordId", interaction.user.id);

      const response = await fetch(apiUrl, {
        headers: {
          "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
        },
      });

      const result = (await response
        .json()
        .catch(() => null)) as ProfileApiResponse | null;

      if (!response.ok || !result?.ok) {
        await interaction.editReply(
          (result && "message" in result ? result.message : null) ??
            "Nie udało się pobrać profilu PokeGlory."
        );
        return;
      }

      if (!result.linked) {
        await interaction.editReply(
          result.message ??
            "Najpierw połącz konto w grze z Discordem komendą /link."
        );
        return;
      }

      await assignVerifiedRole(interaction);

      await interaction.editReply({
        embeds: [buildProfileEmbed(interaction, result)],
      });
    } catch (error) {
      console.error("Error fetching PokeGlory profile:", error);
      await interaction.editReply(
        "Nie udało się pobrać profilu PokeGlory. Spróbuj ponownie za chwilę."
      );
    }
  },
};

export default profilCommand;
