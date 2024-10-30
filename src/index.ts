import "dotenv/config";
import { Client } from "discord.js";
import { config } from "./config";

const client = new Client({
  intents: [
    "Guilds",
    "GuildMessages",
    "DirectMessages",
    "GuildMembers",
    "MessageContent",
  ],
});

client.on("ready", (c) => {
  console.log(`${c.user.username} is online.`);
});

client.login(config.DISCORD_TOKEN);

