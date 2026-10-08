import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import {
  Client, GatewayIntentBits, Partials, Events, ActivityType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  ChannelType, PermissionsBitField
} from "discord.js";
import { handleCommand, handlePrefixCommand, handlePollVote, getVerificationRoles } from "./commands.js";
import { finishVerification, createVerification, getLinkedUser } from "./roblox.js";
import { getConfig, setConfig, db } from "./db.js";
import { DEFAULT_CONFIG } from "./config.js";
import { sendLog } from "./logging.js";
import { moderateMessage, detectJoinRaid } from "./moderation.js";
import { embed, safeChannelName } from "./utils.js";
import { startSocialPolling } from "../modules/social/feeds.js";

const funFacts = JSON.parse(readFileSync(new URL("../config/fun.json", import.meta.url), "utf8")).facts;
const guildIntegrityAlerts = new Map();

function formatRobloxNickname(displayName, username) {
  const base = (displayName || "User").trim();
  const handle = (username || "roblox").trim();
  const nickname = `${base} (@${handle})`;
  return nickname.length > 32 ? `${base.slice(0, 29 - handle.length)} (@${handle})` : nickname;
}

function getConfiguredOwnerIds() {
  return [process.env.BOT_OWNER_ID, process.env.ADMIN_USER_ID, process.env.OWNER_DISCORD_ID].filter(Boolean);
}

async function resolveGuildAlertTarget(guild) {
  const candidateIds = new Set(getConfiguredOwnerIds());
  if (guild?.ownerId) candidateIds.add(guild.ownerId);
  for (const id of candidateIds) {
    try {
      const user = await client.users.fetch(id);
      if (user) return user;
    } catch {}
  }
  if (guild) {
    const names = ["andycodee", "andycodees"];
    for (const name of names) {
      const member = guild.members.cache.find(m => {
        const username = (m.user.username || "").toLowerCase();
        const displayName = (m.user.globalName || "").toLowerCase();
        return username.includes(name) || displayName.includes(name);
      });
      if (member) return member.user;
    }
  }
  return null;
}

function getMissingGuildSetup(guild, cfg = DEFAULT_CONFIG) {
  const missing = [];
  const hasVerifiedRole = guild.roles.cache.get(cfg.verifiedRoleId) || guild.roles.cache.find(r => r.name === "Verified");
  const hasUnverifiedRole = guild.roles.cache.get(cfg.unverifiedRoleId) || guild.roles.cache.find(r => r.name === "Unverified");
  if (!hasVerifiedRole) missing.push("Verified role");
  if (!hasUnverifiedRole) missing.push("Unverified role");
  if (!guild.channels.cache.get(cfg.welcomeChannelId) && !guild.channels.cache.find(c => c.name === "welcome" && c.type === ChannelType.GuildText)) missing.push("welcome channel");
  if (!guild.channels.cache.get(cfg.verificationChannelId) && !guild.channels.cache.find(c => c.name === "verify" && c.type === ChannelType.GuildText)) missing.push("verify channel");
  if (!guild.channels.cache.get(cfg.ticketPanelChannelId) && !guild.channels.cache.find(c => c.name === "tickets" && c.type === ChannelType.GuildText)) missing.push("tickets channel");
  if (!guild.channels.cache.get(cfg.applicationChannelId) && !guild.channels.cache.find(c => c.name === "applications" && c.type === ChannelType.GuildText)) missing.push("applications channel");
  return missing;
}

async function recreateMissingGuildSetup(guild, cfg = DEFAULT_CONFIG) {
  const current = { ...DEFAULT_CONFIG, ...getConfig(guild.id), ...(cfg || {}) };
  const verified = guild.roles.cache.find(r => r.name === "Verified") || await guild.roles.create({ name: "Verified", reason: "POPBOX repair" });
  const unverified = guild.roles.cache.find(r => r.name === "Unverified") || await guild.roles.create({ name: "Unverified", reason: "POPBOX repair" });
  const category = guild.channels.cache.find(c => c.name === "POPBOX Tickets" && c.type === ChannelType.GuildCategory) || await guild.channels.create({ name: "POPBOX Tickets", type: ChannelType.GuildCategory });
  const logs = guild.channels.cache.find(c => c.name === "mod-logs" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "mod-logs", type: ChannelType.GuildText });
  const welcome = guild.channels.cache.find(c => c.name === "welcome" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "welcome", type: ChannelType.GuildText });
  const verification = guild.channels.cache.find(c => c.name === "verify" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "verify", type: ChannelType.GuildText });
  const tickets = guild.channels.cache.find(c => c.name === "tickets" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "tickets", type: ChannelType.GuildText });
  const applications = guild.channels.cache.find(c => c.name === "applications" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "applications", type: ChannelType.GuildText });

  const next = {
    ...DEFAULT_CONFIG,
    ...current,
    verifiedRoleId: verified.id,
    unverifiedRoleId: unverified.id,
    ticketCategoryId: category.id,
    logChannelId: logs.id,
    welcomeChannelId: welcome.id,
    verificationChannelId: verification.id,
    ticketPanelChannelId: tickets.id,
    applicationChannelId: applications.id,
  };

  setConfig(guild.id, next);
  return {
    created: [
      verified ? "Verified role" : null,
      unverified ? "Unverified role" : null,
      welcome ? "welcome channel" : null,
      verification ? "verify channel" : null,
      tickets ? "tickets channel" : null,
      applications ? "applications channel" : null,
      logs ? "mod-logs channel" : null,
      category ? "POPBOX Tickets category" : null,
    ].filter(Boolean)
  };
}

async function scanGuildIntegrity(guild) {
  const cfg = { ...DEFAULT_CONFIG, ...getConfig(guild.id) };
  const missing = getMissingGuildSetup(guild, cfg);
  if (!missing.length) return;

  const target = await resolveGuildAlertTarget(guild);
  if (!target) return;

  const key = `${guild.id}:${missing.join("|")}`;
  if (guildIntegrityAlerts.has(key)) return;
  guildIntegrityAlerts.set(key, Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`repair:${guild.id}`).setLabel("Recreate missing setup").setStyle(ButtonStyle.Primary)
  );

  await target.send({
    content: `POPBOX detected missing setup in **${guild.name}**: ${missing.join(", ")}. Click the button below to recreate it automatically.`,
    components: [row]
  }).catch(() => console.warn(`Unable to DM integrity alert to ${target.tag ?? target.id ?? "owner"}`));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Message, Partials.Channel]
});

const app = express();
app.get("/health", (_, res) => res.json({ ok: true, service: "POPBOX Interactive Bot" }));

app.get("/roblox/callback", async (req, res) => {
  try {
    if (!req.query.code || !req.query.state) throw new Error("Missing OAuth callback parameters.");
    const result = await finishVerification(req.query.state, req.query.code);
    const guildId = process.env.DISCORD_GUILD_ID;
    const guild = await client.guilds.fetch(guildId);
    const cfg = { ...DEFAULT_CONFIG, ...getConfig(guildId) };
    const member = await guild.members.fetch(result.discordId);
    const { verified: verifiedRole, unverified: unverifiedRole, member: memberRole } = getVerificationRoles(guild);
    if (verifiedRole) await member.roles.add(verifiedRole);
    if (memberRole && memberRole.id !== verifiedRole?.id) await member.roles.add(memberRole);
    if (unverifiedRole) await member.roles.remove(unverifiedRole);
    const nick = formatRobloxNickname(result.displayName, result.username);
    await member.setNickname(nick, "Verified via Roblox OAuth").catch(() => {});
    await sendLog(guild, "verification", "🔐 Member Verified", [
      { name:"Discord", value:`${member.user.tag} (${member.id})` },
      { name:"Roblox", value:`${result.username} (${result.robloxId})` },
      { name:"Group role", value:result.groupRole }
    ], 0x57F287);
    res.type("html").send(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="theme-color" content="#f5f6fa">
          <title>Verification complete | POPBOX Interactive</title>
          <style>
            * { box-sizing: border-box; }
            body {
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              display: grid;
              place-items: center;
              background: #f5f6fa;
              color: #171923;
              font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            main {
              width: min(100%, 420px);
              padding: 40px 32px;
              border: 1px solid #e8eaf0;
              border-radius: 20px;
              background: #fff;
              box-shadow: 0 18px 50px rgba(25, 30, 50, .08);
              text-align: center;
            }
            .check {
              width: 58px;
              height: 58px;
              margin: 0 auto 22px;
              display: grid;
              place-items: center;
              border-radius: 50%;
              background: #e9f9ef;
              color: #159447;
              font-size: 30px;
              font-weight: 700;
            }
            .brand {
              margin: 0 0 10px;
              color: #72778a;
              font-size: 12px;
              font-weight: 700;
              letter-spacing: .14em;
              text-transform: uppercase;
            }
            h1 { margin: 0; font-size: clamp(24px, 6vw, 30px); letter-spacing: -.04em; }
            p { margin: 12px 0 0; color: #686e80; font-size: 15px; line-height: 1.6; }
            .hint { margin-top: 26px; padding-top: 20px; border-top: 1px solid #edf0f4; font-size: 13px; }
          </style>
        </head>
        <body>
          <main>
            <div class="check" aria-hidden="true">✓</div>
            <p class="brand">POPBOX Interactive</p>
            <h1>You're verified</h1>
            <p>Your Roblox account is now linked. You can return to Discord.</p>
            <p class="hint">You can close this page now.</p>
          </main>
        </body>
      </html>`);
  } catch (e) {
    res.status(400).send(`<h1>Verification failed</h1><p>${String(e.message).replaceAll("<","&lt;")}</p>`);
  }
});

client.once(Events.ClientReady, async c => {
  const statuses = ["online", "idle", "dnd", "invisible"];
  const activityTypes = {
    playing: ActivityType.Playing,
    streaming: ActivityType.Streaming,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing
  };
  startSocialPolling(c);
  const status = process.env.BOT_STATUS?.toLowerCase();
  const activityType = process.env.BOT_ACTIVITY_TYPE?.toLowerCase();
  const activities = [
    ...(process.env.BOT_ACTIVITY?.trim() ? [process.env.BOT_ACTIVITY.trim()] : []),
    ...funFacts.map(fact => `Fact: ${fact}`),
    "Visit popbox.games",
    "Use /help for commands"
  ];
  let activityIndex = 0;
  const updatePresence = () => {
    c.user.setPresence({
      status: statuses.includes(status) ? status : "online",
      activities: [{
        name: activities[activityIndex++ % activities.length].slice(0, 128),
        type: activityTypes[activityType] ?? ActivityType.Watching
      }]
    });
  };
  updatePresence();
  const presenceTimer = setInterval(updatePresence, 45_000);
  presenceTimer.unref();

  const integrityCheck = async () => {
    for (const guild of c.guilds.cache.values()) {
      try {
        await scanGuildIntegrity(guild);
      } catch (error) {
        console.error(`Integrity scan failed for ${guild.id}:`, error);
      }
    }
  };

  await integrityCheck();
  const integrityTimer = setInterval(integrityCheck, 5 * 60 * 1000);
  integrityTimer.unref();
  console.log(`POPBOX Bot online as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("repair:")) {
        const guildId = interaction.customId.split(":")[1];
        if (!guildId) return interaction.reply({ content: "Missing guild ID for repair action.", ephemeral: true });
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return interaction.reply({ content: "That guild is no longer available.", ephemeral: true });
        const target = await resolveGuildAlertTarget(guild);
        const isAllowed = interaction.user.id === target?.id || interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
        if (!isAllowed) return interaction.reply({ content: "Only the configured owner/admin can repair this setup.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const result = await recreateMissingGuildSetup(guild, { ...DEFAULT_CONFIG, ...getConfig(guild.id) });
        return interaction.editReply({ content: `✅ Recreated the missing POPBOX setup: ${result.created.join(", ")}.` });
      }

      if (interaction.customId.startsWith("pollvote:")) return await handlePollVote(interaction);

      if (interaction.customId === "verify:start") {
        const url = createVerification(interaction.user.id);
        return interaction.reply({
          embeds: [embed("🔐 Verify your Roblox account", `Click [this secure Roblox verification link](${url}) or use the button below. Approving access will link your Roblox account and grant your member roles.`)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Continue to Roblox").setStyle(ButtonStyle.Link).setURL(url)
          )],
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("ticket:")) {
        const type = interaction.customId.split(":")[1];
        const cfg = { ...DEFAULT_CONFIG, ...getConfig(interaction.guild.id) };
        const existing = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND closed_at IS NULL").get(interaction.guild.id, interaction.user.id);
        if (existing) return interaction.reply({ content:`You already have an open ticket: <#${existing.channel_id}>`, ephemeral:true });

        const channel = await interaction.guild.channels.create({
          name: `${type}-${safeChannelName(interaction.user.username)}`,
          type: ChannelType.GuildText,
          parent: cfg.ticketCategoryId || undefined,
          permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny:[PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow:[PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: interaction.client.user.id, allow:[PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
          ]
        });
        db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,NULL)").run(channel.id, interaction.guild.id, interaction.user.id, type, new Date().toISOString());
        await channel.send({ content:`<@${interaction.user.id}>`, embeds:[embed(type === "report" ? "🚨 User Report" : "🎫 General Support", "Please describe your issue. You can upload screenshots/videos/evidence here.")], components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger))]});
        return interaction.reply({ content:`Ticket created: ${channel}`, ephemeral:true });
      }

      if (interaction.customId === "ticket:close") {
        const ticket = db.prepare("SELECT * FROM tickets WHERE channel_id=?").get(interaction.channel.id);
        if (!ticket) return interaction.reply({ content:"Ticket record not found.", ephemeral:true });
        db.prepare("UPDATE tickets SET closed_at=? WHERE channel_id=?").run(new Date().toISOString(), interaction.channel.id);
        await sendLog(interaction.guild, "tickets", "🎫 Ticket Closed", [
          {name:"Channel",value:interaction.channel.toString()},
          {name:"Owner",value:`<@${ticket.owner_id}>`},
          {name:"Closed by",value:interaction.user.toString()}
        ]);
        await interaction.reply("🔒 Closing ticket...");
        return setTimeout(()=>interaction.channel.delete().catch(()=>{}), 1500);
      }

      if (interaction.customId === "application:start") {
        const modal = new ModalBuilder().setCustomId("application:submit").setTitle("POPBOX Application");
        const skills = new TextInputBuilder().setCustomId("skills").setLabel("What can you do?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
        const motivation = new TextInputBuilder().setCustomId("motivation").setLabel("Why do you want to work for POPBOX?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500);
        return interaction.showModal(modal.addComponents(
          new ActionRowBuilder().addComponents(skills),
          new ActionRowBuilder().addComponents(motivation)
        ));
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === "application:submit") {
      const cfg = { ...DEFAULT_CONFIG, ...getConfig(interaction.guild.id) };
      const skills = interaction.fields.getTextInputValue("skills");
      const motivation = interaction.fields.getTextInputValue("motivation");
      const channel = await interaction.guild.channels.create({
        name:`application-${safeChannelName(interaction.user.username)}`,
        type:ChannelType.GuildText,
        parent:cfg.ticketCategoryId || undefined,
        permissionOverwrites:[
          {id:interaction.guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
          {id:interaction.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.AttachFiles,PermissionsBitField.Flags.ReadMessageHistory]},
          {id:interaction.client.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ManageChannels]}
        ]
      });
      const info = db.prepare("INSERT INTO applications (guild_id,user_id,skills,motivation,channel_id,created_at) VALUES (?,?,?,?,?,?)").run(interaction.guild.id,interaction.user.id,skills,motivation,channel.id,new Date().toISOString());
      await channel.send({content:`<@${interaction.user.id}>`,embeds:[embed(`📝 Application #${info.lastInsertRowid}`, `**What can you do?**\n${skills}\n\n**Why POPBOX?**\n${motivation}\n\n**Portfolio:**\nUpload your images, videos, files, or portfolio links below.`)]});
      return interaction.reply({content:`Your application channel is ${channel}. Upload your portfolio there.`,ephemeral:true});
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "roles:select") {
      const cfg = { ...DEFAULT_CONFIG, ...getConfig(interaction.guild.id) };
      const mapping = { x: cfg.notificationRoles?.x };
      for (const [key, roleId] of Object.entries(mapping)) {
        if (!roleId) continue;
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;
        if (interaction.values.includes(key)) await interaction.member.roles.add(role).catch(()=>{});
        else await interaction.member.roles.remove(role).catch(()=>{});
      }
      return interaction.reply({content:"🔔 Notification roles updated.",ephemeral:true});
    }
  } catch (e) {
    console.error(e);
    if (interaction.deferred) await interaction.editReply({content:"Something went wrong. Check the bot console."}).catch(()=>{});
    else if (!interaction.replied) await interaction.reply({content:"Something went wrong. Check the bot console.",ephemeral:true}).catch(()=>{});
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  try {
    if (await moderateMessage(message)) return;
    if (message.content.startsWith("++")) await handlePrefixCommand(message);
  } catch (error) {
    console.error("Message handling failed:", error);
    if (message.content.startsWith("++")) {
      await message.reply("The bulk command failed. Check the bot console and its role hierarchy/permissions.").catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, async member => {
  await detectJoinRaid(member).catch(error => console.error("Raid detection failed:", error));
  const cfg = { ...DEFAULT_CONFIG, ...getConfig(member.guild.id) };
  const role = member.guild.roles.cache.get(cfg.unverifiedRoleId) || member.guild.roles.cache.find(item => item.name === "Unverified");
  if (role) await member.roles.add(role).catch(()=>{});
  const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
  if (channel?.isTextBased()) {
    const e = cfg.embeds.welcome;
    await channel.send({embeds:[embed(e.title, e.description.replaceAll("{user}", member.toString()), e.color)]});
  }
  await sendLog(member.guild,"members","👋 Member Joined",[{name:"Member",value:`${member.user.tag} (${member.id})`}]);
});

client.on(Events.GuildMemberRemove, async member => {
  await sendLog(member.guild,"members","🚪 Member Left",[{name:"Member",value:`${member.user.tag} (${member.id})`}]);
});

client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;
  await sendLog(message.guild,"messages","🗑️ Message Deleted",[
    {name:"Author",value:message.author ? `${message.author.tag} (${message.author.id})`:"Unknown"},
    {name:"Channel",value:message.channel.toString()},
    {name:"Content",value:message.content || "[no cached content]"}
  ]);
});

client.on(Events.MessageUpdate, async (oldMessage,newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  await sendLog(newMessage.guild,"messages","✏️ Message Edited",[
    {name:"Author",value:`${newMessage.author?.tag || "Unknown"} (${newMessage.author?.id || "?"})`},
    {name:"Channel",value:newMessage.channel.toString()},
    {name:"Before",value:oldMessage.content || "[uncached]"},
    {name:"After",value:newMessage.content || "[empty]"}
  ]);
});

client.on(Events.ChannelCreate, async channel => {
  if (channel.guild) await sendLog(channel.guild,"server","📁 Channel Created",[{name:"Channel",value:`${channel.name} (${channel.id})`}]);
});
client.on(Events.ChannelDelete, async channel => {
  if (channel.guild) await sendLog(channel.guild,"server","🗑️ Channel Deleted",[{name:"Channel",value:`${channel.name} (${channel.id})`}]);
});
client.on(Events.RoleCreate, async role => {
  await sendLog(role.guild,"server","🎭 Role Created",[{name:"Role",value:`${role.name} (${role.id})`}]);
});
client.on(Events.RoleDelete, async role => {
  await sendLog(role.guild,"server","🗑️ Role Deleted",[{name:"Role",value:`${role.name} (${role.id})`}]);
});

const port = Number(process.env.WEB_PORT || 3000);
app.listen(port, () => console.log(`POPBOX web server listening on ${port}`));

client.login(process.env.DISCORD_TOKEN);
