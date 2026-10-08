import { readFileSync } from "node:fs";
import { PermissionFlagsBits } from "discord.js";

const settings = JSON.parse(readFileSync(new URL("../config/moderation.json", import.meta.url), "utf8"));
const messageWindows = new Map();
const duplicateWindows = new Map();
const joinWindows = new Map();
const timedOutRaidMembers = new Map();

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function isExempt(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageMessages)
    || settings.exemptRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function hasBadWord(content) {
  return settings.badWords.words.some(word => {
    const normalized = word.trim().toLowerCase();
    if (!normalized) return false;
    return content.toLowerCase().includes(normalized);
  });
}

function contentHasLink(content) {
  return /(?:https?:\/\/|www\.)\S+/i.test(content) || /\b[a-z0-9-]+\.(?:com|net|org|gg|io|dev|co|uk|app|xyz)\b/i.test(content);
}

function isAllowedLink(content) {
  const hosts = [...content.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map(match => match[1].toLowerCase());
  return hosts.some(host => settings.links.allowLinks.some(entry => {
    const allowedHost = entry.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return host === allowedHost || host.endsWith(`.${allowedHost}`);
  }));
}

function isInvite(content) {
  return /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(content);
}

function pushWindow(map, id, now, duration) {
  const times = (map.get(id) || []).filter(timestamp => now - timestamp <= duration);
  times.push(now);
  map.set(id, times);
  return times.length;
}

async function timeoutMember(member, minutes, reason) {
  if (!member.moderatable) return false;
  await member.timeout(minutes * 60_000, reason);
  return true;
}

export async function moderateMessage(message) {
  if (!settings.enabled || !message.guild || message.author.bot || !message.member || isExempt(message.member)) return false;
  const content = message.content || "";
  const now = Date.now();
  const userKey = key(message.guild.id, message.author.id);
  const violations = [];
  let timeoutMinutes = 0;

  if (settings.invites.enabled && isInvite(content)) violations.push("Discord invites are not allowed here.");
  else if (settings.links.enabled && contentHasLink(content) && !isAllowedLink(content)) violations.push("Links are not allowed here.");

  if (settings.badWords.enabled && hasBadWord(content)) violations.push("Please keep the chat respectful.");

  const mentionCount = message.mentions.users.size + message.mentions.roles.size
    + (/@(everyone|here)\b/i.test(content) ? 1 : 0);
  if (settings.mentionSpam.enabled && mentionCount > settings.mentionSpam.maxMentions) {
    violations.push("Please do not mass-mention members.");
    timeoutMinutes = Math.max(timeoutMinutes, settings.mentionSpam.timeoutMinutes);
  }

  const letters = content.match(/[a-z]/gi) || [];
  const capitals = content.match(/[A-Z]/g) || [];
  if (settings.caps.enabled && letters.length >= settings.caps.minimumLength && capitals.length / letters.length >= settings.caps.maximumRatio) {
    violations.push("Please avoid excessive caps.");
  }

  if (settings.duplicate.enabled && content.length >= 5) {
    const duration = settings.duplicate.windowSeconds * 1000;
    const recent = (duplicateWindows.get(userKey) || []).filter(item => now - item.time <= duration);
    const duplicate = recent.filter(item => item.content === content.toLowerCase());
    recent.push({ content: content.toLowerCase(), time: now });
    duplicateWindows.set(userKey, recent);
    if (duplicate.length >= settings.duplicate.repeatCount - 1) {
      violations.push("Please do not repeat the same message.");
      timeoutMinutes = Math.max(timeoutMinutes, settings.duplicate.timeoutMinutes);
    }
  }

  if (settings.spam.enabled) {
    const count = pushWindow(messageWindows, userKey, now, settings.spam.windowSeconds * 1000);
    if (count > settings.spam.maxMessages) {
      violations.push("Please slow down to avoid spamming.");
      timeoutMinutes = Math.max(timeoutMinutes, settings.spam.timeoutMinutes);
    }
  }

  if (!violations.length) return false;
  const uniqueReasons = [...new Set(violations)];
  await message.delete().catch(() => {});
  let timedOut = false;
  if (timeoutMinutes > 0) {
    timedOut = await timeoutMember(message.member, timeoutMinutes, `POPBOX AutoMod: ${uniqueReasons.join(" ")}`).catch(() => false);
  }
  const warning = await message.channel.send({
    content: `${message.author}, ${uniqueReasons.join(" ")}${timeoutMinutes ? timedOut ? ` You were timed out for ${timeoutMinutes} minute(s).` : " I could not apply the timeout; please notify a moderator if this repeats." : ""}`,
    allowedMentions: { users: [message.author.id] }
  }).catch(() => null);
  if (warning) setTimeout(() => warning.delete().catch(() => {}), 7000);
  return true;
}

export async function detectJoinRaid(member) {
  if (!settings.enabled || !settings.raid.enabled || member.user.bot) return;
  const now = Date.now();
  const id = member.guild.id;
  const windowMs = settings.raid.windowSeconds * 1000;
  for (const [memberId, timestamp] of timedOutRaidMembers) {
    if (now - timestamp > windowMs * 4) timedOutRaidMembers.delete(memberId);
  }
  const joins = (joinWindows.get(id) || []).filter(join => now - join.time <= windowMs);
  joins.push({ time: now, member });
  joinWindows.set(id, joins);
  if (joins.length < settings.raid.maxJoins) return;

  for (const join of joins) {
    if (timedOutRaidMembers.has(join.member.id)) continue;
    timedOutRaidMembers.set(join.member.id, now);
    await timeoutMember(join.member, settings.raid.timeoutMinutes, `POPBOX AutoMod: mass join detected (${joins.length} joins in ${settings.raid.windowSeconds}s)`).catch(() => false);
  }
}

export async function reportMassJoin(member) {
  await detectJoinRaid(member);
}
