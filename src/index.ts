import { Client } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { deployCommands } from "./deploy-commands";

export const client = new Client({
  intents: ["Guilds", "GuildMessages", "DirectMessages", "MessageContent"],
});

client.once("ready", () => {
  console.log("Discord bot is ready! 🤖");
});

client.on("guildCreate", async (guild) => {
  await deployCommands({ guildId: guild.id });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) {
    return;
  }
  const { commandName } = interaction;
  if (commands[commandName as keyof typeof commands]) {
    commands[commandName as keyof typeof commands].execute(interaction);
  }
});

// client.on("messageCreate", async (message: Message) => {
//   if (
//     message.channel.name === "bot" &&
//     !message.author.bot &&
//     message.author.id === "428244788618199051"
//   ) {
//     try {
//       const response = await axios.post(
//         "https://pokeglory.erykovsky.partykit.dev/parties/chat/general",
//         {
//           message: message.content,
//         }
//       );
//       console.log(ws);
//       // console.log("Message sent to API:", response.data);
//     } catch (error) {
//       console.error("Failed to send message to API:", error);
//     }
//   }
// });

client.login(config.DISCORD_TOKEN);
