import { EmbedBuilder } from "discord.js";
import { readFileSync } from "node:fs";
import { getConfig, getSocialFeedState, setSocialFeedState } from "../../src/db.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

const socialConfig = JSON.parse(readFileSync(new URL("../../config/social.json", import.meta.url), "utf8"));
const xTemplate = JSON.parse(readFileSync(new URL("../../config/embeds/x.json", import.meta.url), "utf8"));
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const MAX_POSTS_PER_POLL = 10;
const MAX_POSTS_PER_REQUEST = 100;
const xUserIds = new Map();
let reportedError = false;
let pollInProgress = false;
let consecutiveFailures = 0;

function pollIntervalMs() {
  const configuredSeconds = Number(process.env.X_POLL_INTERVAL_SECONDS);
  const seconds = Number.isFinite(configuredSeconds) && configuredSeconds >= 15
    ? configuredSeconds
    : DEFAULT_POLL_INTERVAL_MS / 1000;
  return seconds * 1000;
}

function xUsername() {
  if (process.env.X_USERNAME?.trim()) return process.env.X_USERNAME.trim().replace(/^@/, "");
  try {
    return new URL(process.env.X_FEED_URL).pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") || null;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = body.detail || body.error?.message || body.title || `HTTP ${response.status}`;
    const error = new Error(String(details).slice(0, 400));
    error.status = response.status;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const resetEpochSeconds = Number(response.headers.get("x-rate-limit-reset"));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      error.retryAfterMs = retryAfterSeconds * 1000;
    } else if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds > 0) {
      error.retryAfterMs = Math.max(1000, resetEpochSeconds * 1000 - Date.now());
    }
    throw error;
  }
  return body;
}

async function fetchXPosts(lastId) {
  const bearer = process.env.X_BEARER_TOKEN?.trim();
  const username = xUsername();
  if (!bearer || !username) return null;

  let userId = xUserIds.get(username.toLowerCase());
  if (!userId) {
    const lookup = await fetchJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${bearer}` }
    });
    userId = lookup.data?.id;
    if (!userId) throw new Error("X API did not return a user ID for the configured username.");
    xUserIds.set(username.toLowerCase(), userId);
  }

  const params = new URLSearchParams({ max_results: String(MAX_POSTS_PER_REQUEST), "tweet.fields": "created_at" });
  params.set("exclude", "replies,retweets");
  if (lastId) params.set("since_id", lastId);
  const result = await fetchJson(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params}`, {
    headers: { Authorization: `Bearer ${bearer}` }
  });
  return (result.data || []).map(post => ({
    id: post.id,
    content: post.text || "",
    publishedAt: post.created_at,
    url: `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(post.id)}`
  }));
}

export function getSocialFeedStatus() {
  const username = xUsername();
  const configured = Boolean(process.env.X_BEARER_TOKEN?.trim() && username);
  return {
    x: {
      ready: configured,
      detail: configured ? `X API configured for @${username}; checks every ${Math.round(pollIntervalMs() / 1000)}s with rate-limit backoff` : "Set X_BEARER_TOKEN and X_FEED_URL (or X_USERNAME)"
    }
  };
}

function createPostEmbed(post) {
  const content = post.content || "New X post";
  const description = `${xTemplate.description.replaceAll("{content}", content).replaceAll("{url}", post.url)}\n\n[View post](${post.url})`;
  const embed = new EmbedBuilder()
    .setColor(xTemplate.color)
    .setTitle(xTemplate.title.replaceAll("{content}", content).slice(0, 256))
    .setURL(post.url)
    .setDescription(description.slice(0, 4096))
    .setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date());
  if (xTemplate.footer) embed.setFooter({ text: xTemplate.footer });
  return embed;
}

async function pollXPosts(guild, channel, config) {
  const lastPostId = getSocialFeedState(guild.id, "x");
  const posts = await fetchXPosts(lastPostId);
  if (!posts?.length) return;

  const latestFirst = [...posts].sort((a, b) => (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0));
  if (!lastPostId) {
    setSocialFeedState(guild.id, "x", latestFirst[0].id);
    return;
  }

  const lastIndex = latestFirst.findIndex(post => String(post.id) === String(lastPostId));
  const newPosts = (lastIndex < 0 ? latestFirst : latestFirst.slice(0, lastIndex)).slice(-MAX_POSTS_PER_POLL).reverse();
  for (const post of newPosts) {
    const roleId = config.notificationRoles?.x;
    const canMentionRole = roleId && guild.roles.cache.has(roleId);
    await channel.send({
      content: canMentionRole ? `<@&${roleId}>` : undefined,
      embeds: [createPostEmbed(post)],
      allowedMentions: canMentionRole ? { roles: [roleId] } : { parse: [] }
    });
    setSocialFeedState(guild.id, "x", post.id);
  }
}

export async function pollSocialFeeds(client) {
  if (pollInProgress) return { retryAfterMs: 0 };
  pollInProgress = true;
  let retryAfterMs = 0;
  let failed = false;
  try {
    for (const guild of client.guilds.cache.values()) {
      const config = { ...DEFAULT_CONFIG, ...getConfig(guild.id) };
      const channel = config.notificationChannelId
        ? guild.channels.cache.get(config.notificationChannelId) || await guild.channels.fetch(config.notificationChannelId).catch(() => null)
        : null;
      if (!channel?.isTextBased() || typeof channel.send !== "function") continue;

      try {
        await pollXPosts(guild, channel, config);
        reportedError = false;
      } catch (error) {
        failed = true;
        retryAfterMs = Math.max(retryAfterMs, error.retryAfterMs || 0);
        if (!reportedError) {
          console.error(`X feed failed for guild ${guild.id}:`, error.message || error);
          reportedError = true;
        }
      }
    }
  } finally {
    pollInProgress = false;
  }
  consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
  const backoffMs = Math.min(30_000 * (2 ** Math.min(consecutiveFailures, 5)), MAX_BACKOFF_MS);
  return { retryAfterMs: failed ? Math.min(MAX_BACKOFF_MS, Math.max(retryAfterMs, backoffMs)) : 0 };
}

export function startSocialPolling(client) {
  let timer;
  let stopped = false;
  const schedulePoll = delay => {
    timer = setTimeout(async () => {
      const result = await pollSocialFeeds(client);
      if (!stopped) schedulePoll(result.retryAfterMs || pollIntervalMs());
    }, delay);
    timer.unref();
  };
  schedulePoll(5_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
