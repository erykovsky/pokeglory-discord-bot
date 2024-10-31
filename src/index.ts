import {
  ChannelType,
  Client,
  GatewayIntentBits,
  TextChannel,
  Message,
} from "discord.js";
import { config } from "./config";
import linkCommand from "./commands/link";
import losujCommand from "./commands/losuj";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Define the specific channel ID where the bot should operate
const TARGET_CHANNEL_ID = "1301159276324327449";

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  const commands = [linkCommand, losujCommand];

  await client.application?.commands.set(commands);
});

client.on("messageCreate", async (message: Message) => {
  // Ignore messages from bots to prevent potential loops
  if (message.author.bot) return;

  // Check if the message is from the target channel
  if (message.channelId !== TARGET_CHANNEL_ID) return;

  if (message.content) {
    try {
      // Send message to the same channel (since it's already the target channel)
      const channel = await client.channels.fetch(TARGET_CHANNEL_ID);

      if (channel && channel.type === ChannelType.GuildText) {
        await (channel as TextChannel).send(message.content);
      }

      // Delete the original message
      await message.delete();

      // Send message to Next.js endpoint
      const response = await fetch("https://pokeglory.pl/api/discord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message.content,
          author: message.author.username,
          channelId: message.channel.id,
          guildId: message.guild?.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log("Message sent to endpoint successfully.");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }
});

client.login(config.DISCORD_TOKEN);

