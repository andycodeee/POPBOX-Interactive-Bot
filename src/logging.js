import { AuditLogEvent, EmbedBuilder } from "discord.js";
import { getConfig } from "./db.js";
import { truncate } from "./utils.js";

export async function sendLog(guild, type, title, fields = [], color = 0x5865F2) {
  const cfg = getConfig(guild.id);
  const channelId = cfg.logChannels?.[type] || cfg.logChannelId;
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const e = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  for (const f of fields) e.addFields({ name: f.name, value: truncate(String(f.value ?? "—"), 1024), inline: f.inline ?? false });
  await channel.send({ embeds: [e] }).catch(() => {});
}

export async function resolveAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    return logs.entries.find(e => e.target?.id === targetId)?.executor ?? null;
  } catch {
    return null;
  }
}

export { AuditLogEvent };
