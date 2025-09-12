import { ChatInputCommandInteraction } from "discord.js";

const linkCommand = {
  name: "link",
  description: "Zwraca link do gry.",
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply("https://pokeglory.pl");
  },
};

export default linkCommand;

