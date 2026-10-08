import crypto from "node:crypto";
import { db } from "./db.js";

const AUTH = "https://apis.roblox.com/oauth/v1/authorize";
const TOKEN = "https://apis.roblox.com/oauth/v1/token";
const USERINFO = "https://apis.roblox.com/oauth/v1/userinfo";

function base64url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createVerification(discordId) {
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const redirectUri = process.env.ROBLOX_REDIRECT_URI ||
    new URL("/roblox/callback", process.env.PUBLIC_BASE_URL || "http://localhost:3000").toString();

  db.prepare("INSERT INTO oauth_states (state, discord_id, code_verifier, created_at) VALUES (?, ?, ?, ?)")
    .run(state, discordId, verifier, new Date().toISOString());

  const params = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile",
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account consent"
  });

  return `${AUTH}?${params}`;
}

async function getToken(code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: process.env.ROBLOX_CLIENT_ID,
    client_secret: process.env.ROBLOX_CLIENT_SECRET
  });

  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`Roblox token exchange failed: ${response.status}`);
  return response.json();
}

async function getUserInfo(accessToken) {
  const response = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Roblox userinfo failed: ${response.status}`);
  return response.json();
}

async function getGroupMembership(userId) {
  const groupId = process.env.ROBLOX_GROUP_ID;
  const response = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  if (!response.ok) throw new Error(`Roblox group lookup failed: ${response.status}`);
  const data = await response.json();
  return data.data?.find(x => String(x.group?.id) === String(groupId)) || null;
}

export async function finishVerification(state, code) {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
  if (!row) throw new Error("Invalid or expired verification state.");

  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

  const token = await getToken(code, row.code_verifier);
  const user = await getUserInfo(token.access_token);
  const membership = await getGroupMembership(user.sub);

  if (!membership) {
    throw new Error("Your Roblox account is not a member of the POPBOX Interactive group.");
  }

  db.prepare(`
    INSERT INTO users (discord_id, roblox_id, roblox_username, roblox_display_name, verified_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      roblox_id=excluded.roblox_id,
      roblox_username=excluded.roblox_username,
      roblox_display_name=excluded.roblox_display_name,
      verified_at=excluded.verified_at
  `).run(
    row.discord_id,
    String(user.sub),
    user.preferred_username || null,
    user.name || user.nickname || null,
    new Date().toISOString()
  );

  return {
    discordId: row.discord_id,
    robloxId: String(user.sub),
    username: user.preferred_username || "Unknown",
    displayName: user.name || user.nickname || "Unknown",
    groupRole: membership.role?.name || "Member"
  };
}

export function getLinkedUser(discordId) {
  return db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId);
}
