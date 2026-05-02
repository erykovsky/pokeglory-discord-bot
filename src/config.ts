import dotenv from "dotenv";

dotenv.config();

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  POKEGLORY_API_URL = "https://pokeglory.pl",
  POKEGLORY_DISCORD_BOT_SECRET,
} = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error("Missing environment variables");
}

export const config = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  POKEGLORY_API_URL,
  POKEGLORY_DISCORD_BOT_SECRET,
};
