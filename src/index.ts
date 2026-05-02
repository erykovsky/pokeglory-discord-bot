import { Client, GatewayIntentBits, Message, Interaction } from "discord.js";
import { config } from "./config";
import linkCommand from "./commands/link";
import profilCommand from "./commands/profil";
import losujCommand from "./commands/losuj";
import muteCommand from "./commands/mute";
import unmuteCommand from "./commands/unmute";
import clearCommand from "./commands/clear";
import editCommand from "./commands/edit";
import {
  resolveGameChatChannel,
  startGameChatMirror,
} from "./game-chat-mirror";
import { startGameUpdatesMirror } from "./game-updates-mirror";
import { startPlayerRankingMirror } from "./player-ranking-mirror";
import { startVerifiedRoleSync } from "./verified-role-sync";
import { sendWelcomeMessage } from "./welcome-messages";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Define the specific channel ID where the bot should operate
const TARGET_CHANNEL_ID = "1416080627081412659";

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  const commands = [
    linkCommand,
    profilCommand,
    losujCommand,
    muteCommand,
    unmuteCommand,
    clearCommand,
    editCommand,
  ];

  await client.application?.commands.set(commands);
  startGameChatMirror(client);
  startGameUpdatesMirror(client);
  startPlayerRankingMirror(client);
  startVerifiedRoleSync(client);
});

// Handle slash commands
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "link") {
    await linkCommand.execute(interaction);
  } else if (commandName === "profil") {
    await profilCommand.execute(interaction);
  } else if (commandName === "losuj") {
    await losujCommand.execute(interaction);
  } else if (commandName === "mute") {
    await muteCommand.execute(interaction);
  } else if (commandName === "unmute") {
    await unmuteCommand.execute(interaction);
  } else if (commandName === "clear") {
    await clearCommand.execute(interaction);
  } else if (commandName === "edit") {
    await editCommand.execute(interaction);
  }
});

client.on("messageCreate", async (message: Message) => {
  // Ignore messages from bots to prevent potential loops
  if (message.author.bot) return;

  const gameChatChannel = await resolveGameChatChannel(client);

  if (gameChatChannel && message.channelId === gameChatChannel.id) {
    await message.delete().catch(() => undefined);
    return;
  }

  // Check if the message is from the target channel
  if (message.channelId !== TARGET_CHANNEL_ID) return;

  if (message.content) {
    try {
      // Delete the original message
      await message.delete();

      // Send message to Next.js endpoint
      const response = await fetch("https://pokeglory.pl/api/discord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discordId: message.author.id,
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
      console.error("Error processing message:", error);
    }
  }
});

client.on("guildMemberAdd", async (member) => {
  await sendWelcomeMessage(member);
});

client.login(config.DISCORD_TOKEN);
