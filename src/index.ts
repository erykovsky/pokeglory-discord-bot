import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log("Discord bot is ready!");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "link") {
    await interaction.reply("Join the game at https://pokeglory.pl");
  }
});

client.login(config.DISCORD_TOKEN);

