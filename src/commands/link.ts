import { CommandInteraction } from "discord.js";

const linkCommand = {
  name: "link",
  description: "Zwraca link do gry.",
  async execute(interaction: CommandInteraction) {
    await interaction.reply("https://pokeglory.pl");
  },
};

export default linkCommand;

