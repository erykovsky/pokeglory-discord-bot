import { CommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Provide a link to the game!");

export async function execute(interaction: CommandInteraction) {
  await interaction.reply({
    content: "Join the game at https://pokeglory.pl",
    ephemeral: true,
  });
}
