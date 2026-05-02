import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
} from "discord.js";

import { config } from "../config";
import { assignVerifiedRole } from "../verified-role";

const linkCommand = {
  name: "link",
  description: "Połącz konto Discord z kontem PokeGlory.",
  options: [
    {
      name: "kod",
      description: "Kod wygenerowany w ustawieniach konta PokeGlory.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  async execute(interaction: ChatInputCommandInteraction) {
    const code = interaction.options.getString("kod", true).trim();

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
        `${config.POKEGLORY_API_URL.replace(/\/$/, "")}/api/discord/link`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET,
          },
          body: JSON.stringify({
            code,
            discordId: interaction.user.id,
            discordUsername: interaction.user.username,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | { ok?: boolean; nick?: string; message?: string }
        | null;

      if (!response.ok || !result?.ok) {
        await interaction.editReply(
          result?.message ?? "Nie udało się połączyć konta PokeGlory.",
        );
        return;
      }

      const assignedVerifiedRole = await assignVerifiedRole(interaction);

      await interaction.editReply(
        `Połączono Discorda z kontem PokeGlory: ${result.nick}.${
          assignedVerifiedRole ? " Nadano rolę Początkujący trener." : ""
        }`,
      );
    } catch (error) {
      console.error("Error linking Discord account:", error);
      await interaction.editReply(
        "Nie udało się połączyć konta PokeGlory. Spróbuj ponownie za chwilę.",
      );
    }
  },
};

export default linkCommand;
