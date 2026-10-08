import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();

const dbPath = process.env.DATABASE_PATH || "./data/popbox.sqlite";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  roblox_id TEXT NOT NULL,
  roblox_username TEXT,
  roblox_display_name TEXT,
  verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  guild_id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  skills TEXT NOT NULL,
  motivation TEXT NOT NULL,
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_action_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_feed_state (
  guild_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_post_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, platform)
);

`);
db.pragma("foreign_keys = ON");

export function getConfig(guildId) {
  const row = db.prepare("SELECT json FROM config WHERE guild_id = ?").get(guildId);
  return row ? JSON.parse(row.json) : {};
}

export function setConfig(guildId, config) {
  db.prepare(`
    INSERT INTO config (guild_id, json) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET json = excluded.json
  `).run(guildId, JSON.stringify(config));
}

export function recordAdminAction(guildId, action, payload) {
  return db.prepare("INSERT INTO admin_action_history (guild_id, action, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(guildId, action, JSON.stringify(payload), new Date().toISOString()).lastInsertRowid;
}

export function getLatestAdminAction(guildId) {
  return db.prepare("SELECT * FROM admin_action_history WHERE guild_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1").get(guildId);
}

export function markAdminActionUndone(actionId) {
  db.prepare("UPDATE admin_action_history SET undone_at = ? WHERE id = ?")
    .run(new Date().toISOString(), actionId);
}

export function getSocialFeedState(guildId, platform) {
  return db.prepare("SELECT last_post_id FROM social_feed_state WHERE guild_id = ? AND platform = ?")
    .get(guildId, platform)?.last_post_id || null;
}

export function setSocialFeedState(guildId, platform, postId) {
  db.prepare(`
    INSERT INTO social_feed_state (guild_id, platform, last_post_id, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, platform) DO UPDATE SET last_post_id = excluded.last_post_id, updated_at = excluded.updated_at
  `).run(guildId, platform, String(postId), new Date().toISOString());
}

