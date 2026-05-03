import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

import { config } from "../config";
import { assignVerifiedRole } from "../verified-role";

type DailyApiResponse =
  | {
      ok: true;
      linked: false;
      message?: string;
    }
  | {
      ok: true;
      linked: true;
      claimed: false;
      message?: string;
    }
  | {
      ok: true;
      linked: true;
      claimed: true;
      nick: string;
      reward: {
        kind: "yen" | "item";
        amount: number;
        label: string;
        itemName: string | null;
      };
      message?: string;
    }
  | {
      ok?: false;
      message?: string;
    };

function buildDailyRewardEmbed(result: Extract<DailyApiResponse, { claimed: true }>) {
  return new EmbedBuilder()
    .setColor(0x78adff)
    .setTitle("Nagroda dzienna")
    .setDescription(`Odebrano: **${result.reward.label}**`)
    .addFields({
      name: "Konto",
      value: result.nick,
      inline: true,
    });
}

const dailyCommand = {
  name: "daily",
  description: "Odbierz dzienną nagrodę PokeGlory.",
  async execute(interaction: ChatInputCommandInteraction) {
    if (!config.POKEGLORY_DISCORD_BOT_SECRET) {
      await interaction.reply({
        content: "Integracja PokeGlory z Discordem nie jest jeszcze skonfigurowana.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const response = await fetch(
        `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/daily`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
          },
          body: JSON.stringify({
            discordId: interaction.user.id,
            discordUsername: interaction.user.username,
          }),
        }
      );

      const result = (await response.json().catch(() => null)) as
        | DailyApiResponse
        | null;

      if (!response.ok || !result?.ok) {
        await interaction.editReply(
          result?.message ?? "Nie udało się odebrać nagrody dziennej."
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

      if (!result.claimed) {
        await interaction.editReply(
          result.message ??
            "Nagroda dzienna została już dziś odebrana. Wróć jutro po północy."
        );
        return;
      }

      await interaction.editReply({
        embeds: [buildDailyRewardEmbed(result)],
      });
    } catch (error) {
      console.error("Error claiming PokeGlory daily reward:", error);
      await interaction.editReply(
        "Nie udało się odebrać nagrody dziennej. Spróbuj ponownie za chwilę."
      );
    }
  },
};

export default dailyCommand;
