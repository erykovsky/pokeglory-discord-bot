import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  // Rejestracja komend
  const commands = [
    {
      name: "link",
      description: "Zwraca link do gry.",
    },
    {
      name: "losuj",
      description: "Losuje liczbę od 1 do 100.",
    },
  ];

  await client.application?.commands.set(commands);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "link") {
    await interaction.reply("https://pokeglory.pl");
  } else if (interaction.commandName === "losuj") {
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    await interaction.reply(`Wylosowana liczba to: ${randomNumber}`);
  }
});

client.login(config.DISCORD_TOKEN);

