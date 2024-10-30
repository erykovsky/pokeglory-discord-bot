import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log("Discord bot is ready!");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
  }

  if (interaction.commandName === "link") {
    await interaction.reply("Oto twój link: https://example.com");
  }
});

client.login(config.DISCORD_TOKEN);

