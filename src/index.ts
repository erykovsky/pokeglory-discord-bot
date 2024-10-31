import {
  ChannelType,
  Client,
  GatewayIntentBits,
  TextChannel,
} from "discord.js";
import { config } from "./config";
import linkCommand from "./commands/link";
import losujCommand from "./commands/losuj";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  const commands = [linkCommand, losujCommand];

  await client.application?.commands.set(commands);
});

client.on("messageCreate", async (message) => {
  if (message.content) {
    try {
      const channel = await client.channels.fetch("1301159276324327449");

      if (channel && channel.type === ChannelType.GuildText) {
        await (channel as TextChannel).send(message.content);
      }

      await fetch("https://pokeglory.pl/api/discord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: message.content }),
      });
      console.log("Wiadomość wysłana na endpoint.");
    } catch (error) {
      console.error("Błąd podczas wysyłania wiadomości:", error);
    }
  }
});

client.login(config.DISCORD_TOKEN);

