import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  // Rejestracja komend
  const commands = [
    {
      name: "ping",
      description: "Odpowiada Pong!",
    },
    {
      name: "link",
      description: "Zwraca link.",
    },
  ];

  await client.application?.commands.set(commands);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
  }

  if (interaction.commandName === "link") {
    await interaction.reply("Dołącz do nas: https://pokeglory.pl");
  }
});

client.login(config.DISCORD_TOKEN);

