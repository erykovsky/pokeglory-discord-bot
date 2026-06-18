import {
  Client,
  GatewayIntentBits,
  Interaction,
  Message,
  Partials,
} from "discord.js";
import { config } from "./config";
import linkCommand from "./commands/link";
import profilCommand from "./commands/profil";
import dailyCommand from "./commands/daily";
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
import { startPlayerEventsMirror } from "./player-events-mirror";
import { startPlayerIdeaReactions } from "./player-idea-reactions";
import { startPlayerRankingMirror } from "./player-ranking-mirror";
import { startOrganizationRankingMirror } from "./organization-ranking-mirror";
import { startVerifiedRoleSync } from "./verified-role-sync";
import { sendWelcomeMessage } from "./welcome-messages";
import { startTicketSystem, ticketPanelCommand } from "./tickets";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Define the specific channel ID where the bot should operate
const TARGET_CHANNEL_ID = "1416080627081412659";

client.on("ready", async () => {
  console.log("Discord bot is ready!");

  const commands = [
    linkCommand,
    profilCommand,
    dailyCommand,
    losujCommand,
    muteCommand,
    unmuteCommand,
    clearCommand,
    editCommand,
    ticketPanelCommand,
  ];

  await client.application?.commands.set(commands);
  startPlayerIdeaReactions(client);

  if (config.POKEGLORY_LOCAL_IDEAS_ONLY) {
    console.log("Local ideas-only mode enabled; Discord mirrors are disabled.");
    return;
  }

  startGameChatMirror(client);
  startGameUpdatesMirror(client);
  startPlayerEventsMirror(client);
  startPlayerRankingMirror(client);
  startOrganizationRankingMirror(client);
  startVerifiedRoleSync(client);
  startTicketSystem(client);
});

// Handle slash commands
client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "link") {
    await linkCommand.execute(interaction);
  } else if (commandName === "profil") {
    await profilCommand.execute(interaction);
  } else if (commandName === "daily") {
    await dailyCommand.execute(interaction);
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
  } else if (commandName === "ticket-panel") {
    await ticketPanelCommand.execute(interaction);
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
