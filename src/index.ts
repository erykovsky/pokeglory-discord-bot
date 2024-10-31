import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
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

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  const commands = [linkCommand, losujCommand];

  await client.application?.commands.set(commands);
});

client.on("messageCreate", async (message: Message) => {
  // Ignore messages from bots to prevent potential loops
  if (message.author.bot) return;

  if (message.content) {
    try {
      // Send message to a specific channel
      const channel = await client.channels.fetch("1301159276324327449");

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

      const result = await response.json();
      console.log("Message sent to endpoint successfully:", result);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }
});

client.login(config.DISCORD_TOKEN);
