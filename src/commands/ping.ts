import { CommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong!");

export async function execute(interaction: CommandInteraction) {
  const channel = interaction.channel;
  if (channel) {
    await channel.send("Pong!");
  } else {
    await interaction.reply({
      content: "Cannot access the channel.",
      ephemeral: true,
    });
  }
}
