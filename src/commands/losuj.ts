import { CommandInteraction } from "discord.js";

const losujCommand = {
  name: "losuj",
  description: "Losuje liczbę od 1 do 100.",
  async execute(interaction: CommandInteraction) {
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    await interaction.reply(`Wylosowana liczba to: ${randomNumber}`);
  },
};

export default losujCommand;

