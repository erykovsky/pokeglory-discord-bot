import { CommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("random")
  .setDescription("Losuje liczbę od 1 do 100!");

export async function execute(interaction: CommandInteraction) {
  const randomNumber = Math.floor(Math.random() * 100) + 1;
  await interaction.reply({
    content: `🎲 Wylosowana liczba to: ${randomNumber}`,
    ephemeral: true,
  });
}
