import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
  { body: commands.map(c => c.toJSON()) }
);
console.log("POPBOX slash commands registered.");
