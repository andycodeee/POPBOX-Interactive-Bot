import { EmbedBuilder } from "discord.js";

export const BRAND = 0x5865F2;

export function embed(title, description, color = BRAND) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function truncate(value, max = 1000) {
  if (!value) return "";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

export function safeChannelName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 80);
}
