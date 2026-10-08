import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
  AutoModerationActionType, AutoModerationRuleEventType,
  AutoModerationRuleTriggerType, AutoModerationRuleKeywordPresetType
} from "discord.js";
import { readFileSync } from "node:fs";
import { db, getConfig, setConfig, recordAdminAction, getLatestAdminAction, markAdminActionUndone } from "./db.js";
import { DEFAULT_CONFIG } from "./config.js";
import { createVerification, getLinkedUser } from "./roblox.js";
import { embed, safeChannelName } from "./utils.js";
import { getSocialFeedStatus } from "../modules/social/feeds.js";

const mod = PermissionFlagsBits.ModerateMembers;
const accessControl = JSON.parse(readFileSync(new URL("../config/access-control.json", import.meta.url), "utf8"));
const socialConfig = JSON.parse(readFileSync(new URL("../config/social.json", import.meta.url), "utf8"));
const funConfig = JSON.parse(readFileSync(new URL("../config/fun.json", import.meta.url), "utf8"));

export const commands = [
  new SlashCommandBuilder().setName("verify").setDescription("Get your personal POPBOX Roblox verification link.")
    .addSubcommand(s => s.setName("link").setDescription("Get your personal Roblox verification link."))
    .addSubcommand(s => s.setName("panel").setDescription("Create or refresh the public verification channel panel.")),
  new SlashCommandBuilder().setName("resetup").setDescription("Apply the channel access policy from config/access-control.json.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o => o.setName("confirm").setDescription("Confirm updating channel role permissions.").setRequired(true)),
  new SlashCommandBuilder().setName("social").setDescription("Configure social notification roles and channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("setup").setDescription("Create the X notification role and set its post channel."))
    .addSubcommand(s => s.setName("status").setDescription("Check social feed connections and destination.")),
  new SlashCommandBuilder().setName("automod").setDescription("Configure Discord's native AutoMod rules.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("setup").setDescription("Create or update POPBOX rules in Discord AutoMod."))
    .addSubcommand(s => s.setName("status").setDescription("Show Discord AutoMod rules and per-server limits.")),
  new SlashCommandBuilder().setName("undo").setDescription("Undo the most recent supported admin action.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(o => o.setName("confirm").setDescription("Confirm undoing the most recent action.").setRequired(true)),
  new SlashCommandBuilder().setName("profile").setDescription("Show your linked POPBOX/Roblox profile."),
  new SlashCommandBuilder().setName("help").setDescription("Show the commands available in this bot."),
  new SlashCommandBuilder().setName("popbox").setDescription("Get a random POPBOX fact or studio message."),
  new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin."),
  new SlashCommandBuilder().setName("8ball").setDescription("Ask the magic 8-ball a question.")
    .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName("ship").setDescription("Get a silly team collaboration score.")
    .addUserOption(o => o.setName("first").setDescription("First teammate").setRequired(true))
    .addUserOption(o => o.setName("second").setDescription("Second teammate").setRequired(true)),
  new SlashCommandBuilder().setName("quote").setDescription("Display a funny team quote."),
  new SlashCommandBuilder().setName("developer").setDescription("Get a random developer fact."),
  new SlashCommandBuilder().setName("daily").setDescription("Get today's studio message."),
  new SlashCommandBuilder().setName("roast").setDescription("Get a playful developer roast."),
  new SlashCommandBuilder().setName("userinfo").setDescription("Show information about a server member.")
    .addUserOption(o => o.setName("user").setDescription("Member to inspect")),
  new SlashCommandBuilder().setName("avatar").setDescription("Show a member's avatar.")
    .addUserOption(o => o.setName("user").setDescription("Member whose avatar to show")),
  new SlashCommandBuilder().setName("banner").setDescription("Show a member's profile banner.")
    .addUserOption(o => o.setName("user").setDescription("Member whose banner to show")),
  new SlashCommandBuilder().setName("roleinfo").setDescription("Show information about a role.")
    .addRoleOption(o => o.setName("role").setDescription("Role to inspect").setRequired(true)),
  new SlashCommandBuilder().setName("membercount").setDescription("Show the server member count."),
  new SlashCommandBuilder().setName("joined").setDescription("Show when a member joined this server.")
    .addUserOption(o => o.setName("user").setDescription("Member to check")),
  new SlashCommandBuilder().setName("announce").setDescription("Post an announcement embed.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("title").setDescription("Announcement title").setRequired(true).setMaxLength(256))
    .addStringOption(o => o.setName("message").setDescription("Announcement text").setRequired(true).setMaxLength(4000))
    .addChannelOption(o => o.setName("channel").setDescription("Destination channel")),
  new SlashCommandBuilder().setName("embed").setDescription("Send a custom embed.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("title").setDescription("Embed title").setRequired(true).setMaxLength(256))
    .addStringOption(o => o.setName("message").setDescription("Embed description").setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #5865F2"))
    .addChannelOption(o => o.setName("channel").setDescription("Destination channel")),
  new SlashCommandBuilder().setName("say").setDescription("Send a message as the bot.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true).setMaxLength(2000))
    .addChannelOption(o => o.setName("channel").setDescription("Destination channel")),
  new SlashCommandBuilder().setName("role").setDescription("Create or delete a server role.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName("create").setDescription("Create a role.")
      .addStringOption(o => o.setName("name").setDescription("Role name").setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #5865F2")))
    .addSubcommand(s => s.setName("delete").setDescription("Delete a role.")
      .addRoleOption(o => o.setName("role").setDescription("Role to delete").setRequired(true))),
  new SlashCommandBuilder().setName("giverole").setDescription("Give a role to a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to give").setRequired(true)),
  new SlashCommandBuilder().setName("removerole").setDescription("Remove a role from a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true)),
  new SlashCommandBuilder().setName("setnick").setDescription("Set a member's nickname.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("nickname").setDescription("New nickname; leave empty to clear").setMaxLength(32)),
  new SlashCommandBuilder().setName("channel").setDescription("Lock or unlock a text channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(s => s.setName("lock").setDescription("Prevent members from sending messages.")
      .addChannelOption(o => o.setName("target").setDescription("Channel to lock")))
    .addSubcommand(s => s.setName("unlock").setDescription("Allow members to send messages again.")
      .addChannelOption(o => o.setName("target").setDescription("Channel to unlock"))),
  new SlashCommandBuilder().setName("poll").setDescription("Create a button-voting poll.")
    .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true).setMaxLength(250))
    .addStringOption(o => o.setName("options").setDescription("2–5 options separated by commas").setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder().setName("warn").setDescription("Warn a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder().setName("warnings").setDescription("Show a member's warnings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("clearwarn").setDescription("Clear a member's warnings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder().setName("unban").setDescription("Unban a user ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName("user_id").setDescription("Discord user ID").setRequired(true)),
  new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .setDefaultMemberPermissions(mod)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason")),
  new SlashCommandBuilder().setName("untimeout").setDescription("Remove a timeout.")
    .setDefaultMemberPermissions(mod)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("clear").setDescription("Delete recent messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("amount").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("slowmode").setDescription("Set channel slowmode.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName("seconds").setDescription("0-21600").setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName("lock").setDescription("Lock the current channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("unlock").setDescription("Unlock the current channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("nick").setDescription("Change a member nickname.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("nickname").setDescription("New nickname").setRequired(true)),
  new SlashCommandBuilder().setName("roles").setDescription("Open the notification-role selector."),
  new SlashCommandBuilder().setName("serverinfo").setDescription("Read a summary of this server."),
  new SlashCommandBuilder().setName("tickets").setDescription("Post the ticket panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("apply").setDescription("Post the application panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("config").setDescription("Configure POPBOX bot.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("setup").setDescription("Create the basic POPBOX roles/channels."))
    .addSubcommand(s => s.setName("view").setDescription("Show current configuration.")),
];

export async function handleCommand(interaction) {
  const guild = interaction.guild;
  if (!guild && interaction.commandName !== "verify") return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });

  const name = interaction.commandName;
  const cfg = guild ? { ...DEFAULT_CONFIG, ...getConfig(guild.id) } : {};
  const definition = commands.find(command => command.name === name)?.toJSON();
  const requiredPermissions = definition?.default_member_permissions;
  if (requiredPermissions && !interaction.memberPermissions?.has(BigInt(requiredPermissions))) {
    return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
  }

  if (name === "help") {
    const lines = commands.filter(command => !command.toJSON().default_member_permissions).map(command => {
      const { name: commandName, description, options = [] } = command.toJSON();
      const subcommands = options
        .filter(option => option.type === 1 && !(commandName === "verify" && option.name === "panel"))
        .map(option => option.name);
      const usage = subcommands.length ? `/${commandName} ${subcommands.join("|")}` : `/${commandName}`;
      return `**${usage}** — ${description}`;
    });
    const pages = [];
    let page = "";
    for (const line of lines) {
      if (page && page.length + line.length + 1 > 3900) {
        pages.push(page);
        page = "";
      }
      page += `${page ? "\n" : ""}${line}`;
    }
    if (page) pages.push(page);
    return interaction.reply({
      embeds: pages.map((description, index) => new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🤖 POPBOX Commands${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ""}`)
        .setDescription(`${description}\n\nSome commands may require specific server permissions.`)),
      ephemeral: true
    });
  }

  if (name === "verify") {
    // Older registered versions of `/verify` had no subcommands; keep them working as the link command.
    const subcommand = interaction.options.getSubcommand(false) || "link";
    if (subcommand === "panel") {
      if (!isAdministrator(interaction)) return interaction.reply({ content: "Only server administrators can create the verification panel.", ephemeral: true });
      const channel = await publishVerificationPanel(guild, cfg);
      return interaction.reply({ content: `✅ Verification panel posted in ${channel}. Unverified members can view it but cannot chat there.`, ephemeral: true });
    }
    if (subcommand !== "link") return interaction.reply({ content: "Bulk verification is now prefix-based: `++verify all confirm`.", ephemeral: true });
    if (!process.env.ROBLOX_CLIENT_ID) return interaction.reply({ content: "Roblox verification is not configured yet.", ephemeral: true });
    const url = createVerification(interaction.user.id);
    return interaction.reply({
      embeds: [embed("🔐 Verify your Roblox account", `Click [this secure Roblox verification link](${url}) or use the button below to continue.`)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Continue to Roblox").setStyle(ButtonStyle.Link).setURL(url))],
      ephemeral: true
    });
  }

  if (name === "unverify" || name === "requestverify") {
    return interaction.reply({ content: `This bulk command is prefix-based now: ++${name} all confirm`, ephemeral: true });
  }

  if (name === "popbox") return replyRandom(interaction, "🛋️ POPBOX fact", funConfig.facts);
  if (name === "coinflip") return interaction.reply(`🪙 It landed on **${Math.random() < 0.5 ? "Heads" : "Tails"}**!`);
  if (name === "8ball") {
    const question = interaction.options.getString("question");
    const answer = pickRandom(funConfig.eightBall);
    return interaction.reply({ embeds: [embed(`🎱 ${question}`, answer)] });
  }
  if (name === "ship") {
    const first = interaction.options.getUser("first");
    const second = interaction.options.getUser("second");
    const score = Math.floor(Math.random() * 101);
    return interaction.reply({ embeds: [embed("🤝 Teamwork meter", `${first} + ${second}: **${score}%** collaboration compatibility. Purely for fun!`)] });
  }
  if (name === "quote") return replyRandom(interaction, "💬 Team quote", funConfig.quotes);
  if (name === "developer") return replyRandom(interaction, "💻 Developer fact", funConfig.developerFacts);
  if (name === "daily") {
    const today = new Date();
    const dayNumber = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000);
    return interaction.reply({ embeds: [embed("☀️ POPBOX daily", funConfig.dailyMessages[dayNumber % funConfig.dailyMessages.length])] });
  }
  if (name === "roast") return replyRandom(interaction, "🔥 Friendly developer roast", funConfig.roasts);

  if (name === "userinfo") return showUserInfo(interaction);
  if (name === "avatar") return showAvatar(interaction);
  if (name === "banner") return showBanner(interaction);
  if (name === "membercount") return showMemberCount(interaction);
  if (name === "joined") return showJoined(interaction);
  if (name === "roleinfo") return showRoleInfo(interaction);

  if (name === "announce" || name === "embed" || name === "say") return sendManagedMessage(interaction, name);
  if (name === "role") return manageRole(interaction);
  if (name === "giverole" || name === "removerole") return changeMemberRole(interaction, name);
  if (name === "setnick") return setMemberNickname(interaction);
  if (name === "channel") return manageChannel(interaction);
  if (name === "poll") return createPoll(interaction);

  if (name === "resetup") {
    if (!isAdministrator(interaction)) return interaction.reply({ content: "Only server administrators can reset channel access permissions.", ephemeral: true });
    if (!interaction.options.getBoolean("confirm")) return interaction.reply({ content: "Nothing changed. Set `confirm` to true to apply the access policy.", ephemeral: true });
    const roles = getVerificationRoles(guild);
    const memberRole = guild.roles.cache.get(accessControl.roles.member.id) || guild.roles.cache.find(role => role.name === accessControl.roles.member.name);
    if (!roles.verified || !roles.unverified || !memberRole) {
      return interaction.reply({ content: "A required role is missing. Check the role IDs in config/access-control.json.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await applyChannelAccessPolicy(guild, roles, memberRole);
    return interaction.editReply(`✅ Updated access on ${result.updated} channels; preserved ${result.preserved} staff, transcript, and ticket channels. ${result.failed ? `${result.failed} channel updates failed; give the bot Manage Channels/Manage Roles and move its role above Verified, Unverified, and Members.` : ""}`);
  }

  if (name === "social") {
    if (!isAdministrator(interaction)) return interaction.reply({ content: "Only server administrators can configure social feeds.", ephemeral: true });
    if (interaction.options.getSubcommand() === "status") {
      const status = getSocialFeedStatus();
      const destination = cfg.notificationChannelId
        ? guild.channels.cache.get(cfg.notificationChannelId)?.toString() || "Configured channel is missing"
        : "Not configured (run /social setup and make sure a #socials channel exists)";
      const lines = Object.entries(status).map(([platform, result]) => `${result.ready ? "✅" : "⚠️"} **${platform.toUpperCase()}** — ${result.detail}`);
      return interaction.reply({
        embeds: [embed("📡 Social Feed Status", `**Post destination:** ${destination}\n**Poll interval:** 3 minutes\n\n${lines.join("\n")}`)],
        ephemeral: true
      });
    }

    const platformRoles = await ensureSocialRoles(guild);
    const channelName = socialConfig.notificationChannelName.toLowerCase();
    const socialsChannel = guild.channels.cache.find(channel => channel.name.toLowerCase() === channelName && channel.isTextBased());
    const next = {
      ...DEFAULT_CONFIG,
      ...cfg,
      notificationChannelId: socialsChannel?.id || cfg.notificationChannelId || null,
      notificationRoles: {
        ...DEFAULT_CONFIG.notificationRoles,
        ...(cfg.notificationRoles || {}),
        ...Object.fromEntries(Object.entries(platformRoles).map(([key, role]) => [key, role.id]))
      }
    };
    setConfig(guild.id, next);
    const platformLabels = Object.values(socialConfig.platforms).filter(platform => platform.enabled).map(platform => platform.label).join(", ");
    return interaction.reply({
      content: `✅ Configured notification roles for ${platformLabels}${socialsChannel ? ` and selected ${socialsChannel} for social posts` : ""}. Run /roles to post a selector for members.`,
      ephemeral: true
    });
  }

  if (name === "automod") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "You need Manage Server to configure Discord AutoMod.", ephemeral: true });
    }
    if (interaction.options.getSubcommand() === "status") return showNativeAutoModStatus(interaction);
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await setupNativeAutoMod(guild);
      return interaction.editReply(result.message);
    } catch (error) {
      console.error("Discord AutoMod setup failed:", error);
      return interaction.editReply(`Discord AutoMod setup failed: ${String(error.message || error).slice(0, 1200)}. Check that the bot has Manage Server and, for timeout actions, Moderate Members.`);
    }
  }

  if (name === "undo") {
    if (!isAdministrator(interaction)) return interaction.reply({ content: "Only server administrators can undo admin actions.", ephemeral: true });
    if (!interaction.options.getBoolean("confirm")) return interaction.reply({ content: "Nothing changed. Set `confirm` to true to undo the most recent action.", ephemeral: true });
    const action = getLatestAdminAction(guild.id);
    if (!action) return interaction.reply({ content: "There are no supported admin actions to undo in this server.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    const result = await undoAdminAction(guild, action);
    if (result.complete) markAdminActionUndone(action.id);
    return interaction.editReply(`${result.complete ? "↩️" : "⚠️"} ${result.message}${result.complete ? "" : " Some items could not be restored; fix the bot permissions/role hierarchy and run `/undo confirm:true` again."}`);
  }

  if (name === "profile") {
    const u = getLinkedUser(interaction.user.id);
    if (!u) return interaction.reply({ content: "You are not verified yet. Use `/verify link`.", ephemeral: true });
    return interaction.reply({ embeds: [embed("👤 POPBOX Profile",
      `**Discord:** ${interaction.user}\n**Roblox:** [${u.roblox_username}](https://www.roblox.com/users/${u.roblox_id}/profile)\n**Display name:** ${u.roblox_display_name || "—"}\n**Verified:** <t:${Math.floor(new Date(u.verified_at).getTime()/1000)}:R>`)] });
  }

  if (name === "warn") {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    db.prepare("INSERT INTO warnings (guild_id,user_id,moderator_id,reason,created_at) VALUES (?,?,?,?,?)")
      .run(guild.id, user.id, interaction.user.id, reason, new Date().toISOString());
    return interaction.reply({ content: `⚠️ Warned ${user} for: ${reason}` });
  }

  if (name === "warnings") {
    const user = interaction.options.getUser("user");
    const rows = db.prepare("SELECT * FROM warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC").all(guild.id, user.id);
    const desc = rows.length ? rows.map((r,i)=>`**${i+1}.** ${r.reason} — <@${r.moderator_id}>`).join("\n") : "No warnings.";
    return interaction.reply({ embeds: [embed(`⚠️ Warnings — ${user.username}`, desc)] });
  }

  if (name === "clearwarn") {
    const user = interaction.options.getUser("user");
    db.prepare("DELETE FROM warnings WHERE guild_id=? AND user_id=?").run(guild.id, user.id);
    return interaction.reply({ content: `Cleared warnings for ${user}.` });
  }

  if (["kick","ban","timeout","untimeout"].includes(name)) {
    const member = interaction.options.getMember("user");
    if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });
    if (!member.moderatable && name !== "ban") return interaction.reply({ content: "I cannot moderate that member.", ephemeral: true });
    const reason = interaction.options.getString("reason") || `Action by ${interaction.user.tag}`;
    if (name === "kick") await member.kick(reason);
    if (name === "ban") await member.ban({ reason });
    if (name === "timeout") await member.timeout(interaction.options.getInteger("minutes")*60*1000, reason);
    if (name === "untimeout") await member.timeout(null, reason);
    return interaction.reply({ content: `✅ ${name} completed for ${member}.` });
  }

  if (name === "unban") {
    const id = interaction.options.getString("user_id");
    await guild.members.unban(id);
    return interaction.reply({ content: `✅ Unbanned <@${id}>.` });
  }

  if (name === "clear") {
    const amount = interaction.options.getInteger("amount");
    const deleted = await interaction.channel.bulkDelete(amount, true);
    return interaction.reply({ content: `🧹 Deleted ${deleted.size} messages.`, ephemeral: true });
  }

  if (name === "slowmode") {
    await interaction.channel.setRateLimitPerUser(interaction.options.getInteger("seconds"));
    return interaction.reply({ content: "✅ Slowmode updated." });
  }

  if (name === "lock" || name === "unlock") {
    await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: name === "unlock" });
    return interaction.reply({ content: name === "lock" ? "🔒 Channel locked." : "🔓 Channel unlocked." });
  }

  if (name === "nick") {
    const member = interaction.options.getMember("user");
    await member.setNickname(interaction.options.getString("nickname"));
    return interaction.reply({ content: `✅ Nickname updated for ${member}.` });
  }

  if (name === "serverinfo") return sendServerInfo(interaction);
  if (name === "roles") return sendRolePanel(interaction);
  if (name === "tickets") return sendTicketPanel(interaction);
  if (name === "apply") return sendApplicationPanel(interaction);

  if (name === "config") {
    if (interaction.options.getSubcommand() === "view") {
      return interaction.reply({ content: "```json\n" + JSON.stringify(cfg, null, 2).slice(0, 1900) + "\n```", ephemeral: true });
    }
    if (interaction.options.getSubcommand() === "setup") {
      const verified = guild.roles.cache.find(r => r.name === "Verified") || await guild.roles.create({ name: "Verified", reason: "POPBOX setup" });
      const unverified = guild.roles.cache.find(r => r.name === "Unverified") || await guild.roles.create({ name: "Unverified", reason: "POPBOX setup" });
      const socialRoles = await ensureSocialRoles(guild);
      const category = guild.channels.cache.find(c => c.name === "POPBOX Tickets" && c.type === ChannelType.GuildCategory) || await guild.channels.create({ name: "POPBOX Tickets", type: ChannelType.GuildCategory });
      const logs = guild.channels.cache.find(c => c.name === "mod-logs" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "mod-logs", type: ChannelType.GuildText });
      const welcome = guild.channels.cache.find(c => c.name === "welcome" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "welcome", type: ChannelType.GuildText });
      const verification = guild.channels.cache.find(c => c.name === "verify" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "verify", type: ChannelType.GuildText });
      const tickets = guild.channels.cache.find(c => c.name === "tickets" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "tickets", type: ChannelType.GuildText });
      const applications = guild.channels.cache.find(c => c.name === "applications" && c.type === ChannelType.GuildText) || await guild.channels.create({ name: "applications", type: ChannelType.GuildText });

      const next = { ...DEFAULT_CONFIG, ...cfg,
        verifiedRoleId: verified.id, unverifiedRoleId: unverified.id,
        ticketCategoryId: category.id, logChannelId: logs.id,
        welcomeChannelId: welcome.id, verificationChannelId: verification.id,
        ticketPanelChannelId: tickets.id, applicationChannelId: applications.id,
        notificationRoles: {
          ...DEFAULT_CONFIG.notificationRoles,
          ...(cfg.notificationRoles || {}),
          ...Object.fromEntries(Object.entries(socialRoles).map(([key, role]) => [key, role.id]))
        }
      };
      setConfig(guild.id, next);

      // Make new members unverified automatically.
      await guild.members.fetch();
      for (const member of guild.members.cache.values()) {
        if (!member.user.bot) await member.roles.add(unverified).catch(()=>{});
      }
      await publishVerificationPanel(guild, next);
      return interaction.reply({ content: "✅ POPBOX base setup completed. Run `/resetup` and set `confirm` to true to apply the channel access policy.", ephemeral: true });
    }
  }
}

export async function handlePrefixCommand(message) {
  const content = message.content.trim().toLowerCase().replace(/\s+/g, " ");
  const match = /^\+\+(verify|unverify|requestverify)(?:\s+(.*))?$/.exec(content);
  if (!match) return false;

  const [, action, args = ""] = match;
  if (message.author.bot || !message.guild) return true;
  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("Only server administrators can use bulk verification commands.");
    return true;
  }

  const [target, confirmation, ...extra] = args.split(" ");
  if (target !== "all" || confirmation !== "confirm" || extra.length) {
    await message.reply(`Usage: \`++${action} all confirm\`. This affects the whole server.`);
    return true;
  }

  const guild = message.guild;
  if (action === "requestverify" && (!process.env.ROBLOX_CLIENT_ID || !process.env.ROBLOX_REDIRECT_URI)) {
    await message.reply("Roblox OAuth is not fully configured.");
    return true;
  }

  const roles = getVerificationRoles(guild);
  if (!roles.verified || !roles.unverified) {
    await message.reply("The Verified or Unverified role from config/access-control.json was not found.");
    return true;
  }
  if (action === "requestverify") {
    const progress = await message.reply("Preparing verification DMs…");
    const result = await requestVerificationForAll(guild, roles.verified);
    await progress.edit(`📨 Sent verification DMs to ${result.sent}/${result.total} unverified human members.${result.failed ? ` ${result.failed} DMs could not be delivered (closed DMs or an error).` : ""}`);
    return true;
  }

  const progress = await message.reply("Updating verification roles for all human members…");
  const result = await changeVerificationForAll(guild, roles, action);
  const summary = action === "verify"
    ? `✅ Added Verified and Members, and removed Unverified for ${result.updated}/${result.total} human members.`
    : `✅ Added Unverified, and removed Verified and Members for ${result.updated}/${result.total} human members.`;
  await progress.edit(`${summary}${result.failed ? ` ${result.failed} failed; check the bot role hierarchy and Manage Roles permission.` : ""}`);
  return true;
}

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function ensureSocialRoles(guild) {
  const roles = {};
  for (const [key, platform] of Object.entries(socialConfig.platforms)) {
    if (!platform.enabled) continue;
    roles[key] = guild.roles.cache.find(role => role.name === platform.roleName)
      || await guild.roles.create({ name: platform.roleName, reason: "POPBOX social notification setup" });
  }
  return roles;
}

const POPBOX_AUTOMOD_PREFIX = "[POPBOX AutoMod] ";

async function fetchNativeAutoModRules(guild) {
  return guild.autoModerationRules.fetch();
}

async function upsertNativeAutoModRule(guild, existingRules, specification) {
  const existing = existingRules.find(rule => rule.name === specification.name);
  const options = {
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: specification.triggerType,
    triggerMetadata: specification.triggerMetadata,
    actions: specification.actions,
    enabled: true,
    exemptRoles: specification.exemptRoles,
    reason: "POPBOX native AutoMod setup"
  };

  if (existing) {
    await guild.autoModerationRules.edit(existing.id, options);
    return "updated";
  }

  await guild.autoModerationRules.create({ name: specification.name, ...options });
  return "created";
}

async function setupNativeAutoMod(guild) {
  const settings = JSON.parse(readFileSync(new URL("../config/moderation.json", import.meta.url), "utf8"));
  const rules = await fetchNativeAutoModRules(guild);
  const ownedRules = [...rules.values()].filter(rule => rule.name.startsWith(POPBOX_AUTOMOD_PREFIX));
  const exemptRoles = settings.exemptRoleIds.filter(roleId => guild.roles.cache.has(roleId));
  const alertChannel = settings.alertChannelId ? guild.channels.cache.get(settings.alertChannelId) : null;
  const canTimeout = guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers) ?? false;
  const blockAction = {
    type: AutoModerationActionType.BlockMessage,
    metadata: { customMessage: "This message was stopped by POPBOX's Discord AutoMod filter." }
  };
  const actionsFor = ({ timeoutMinutes = 0 } = {}) => {
    const actions = [blockAction];
    if (alertChannel?.isTextBased()) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel } });
    if (timeoutMinutes > 0 && canTimeout) actions.push({
      type: AutoModerationActionType.Timeout,
      metadata: { durationSeconds: Math.min(timeoutMinutes * 60, 2419200) }
    });
    return actions;
  };
  const plannedRules = [];

  const linkRegexes = [];
  if (settings.links.enabled) linkRegexes.push("(?:https?://|www\\.)[^\\s]+");
  if (settings.invites.enabled) linkRegexes.push("(?:discord\\.gg|discord(?:app)?\\.com/invite)/[A-Za-z0-9-]+");
  if (linkRegexes.length) plannedRules.push({
    name: `${POPBOX_AUTOMOD_PREFIX} Links and invites`,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: { regexPatterns: linkRegexes },
    actions: actionsFor()
  });

  const badWords = settings.badWords.words.map(word => word.trim()).filter(Boolean);
  if (settings.badWords.enabled && badWords.length) {
    if (badWords.length > 1000 || badWords.some(word => word.length > 60)) {
      throw new Error("Discord AutoMod accepts up to 1,000 custom terms per rule, with a maximum of 60 characters per term.");
    }
    plannedRules.push({
      name: `${POPBOX_AUTOMOD_PREFIX} Custom blocked words`,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: badWords },
      actions: actionsFor({ timeoutMinutes: 1 })
    });
  }

  if (settings.spam.enabled) plannedRules.push({
    name: `${POPBOX_AUTOMOD_PREFIX} Spam content`,
    triggerType: AutoModerationRuleTriggerType.Spam,
    actions: actionsFor()
  });

  if (settings.mentionSpam.enabled) plannedRules.push({
    name: `${POPBOX_AUTOMOD_PREFIX} Mention spam`,
    triggerType: AutoModerationRuleTriggerType.MentionSpam,
    triggerMetadata: {
      mentionTotalLimit: Math.min(Math.max(1, settings.mentionSpam.maxMentions), 50),
      mentionRaidProtectionEnabled: true
    },
    actions: actionsFor({ timeoutMinutes: settings.mentionSpam.timeoutMinutes })
  });

  plannedRules.push({
    name: `${POPBOX_AUTOMOD_PREFIX} Commonly flagged words`,
    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
    triggerMetadata: { presets: [
      AutoModerationRuleKeywordPresetType.Profanity,
      AutoModerationRuleKeywordPresetType.SexualContent,
      AutoModerationRuleKeywordPresetType.Slurs
    ] },
    actions: actionsFor()
  });

  const typeLimits = new Map([
    [AutoModerationRuleTriggerType.Keyword, 6],
    [AutoModerationRuleTriggerType.Spam, 1],
    [AutoModerationRuleTriggerType.KeywordPreset, 1],
    [AutoModerationRuleTriggerType.MentionSpam, 1],
    [AutoModerationRuleTriggerType.MemberProfile, 1]
  ]);
  const plannedOwned = new Map();
  for (const plan of plannedRules) plannedOwned.set(plan.triggerType, (plannedOwned.get(plan.triggerType) || 0) + 1);
  const typeCounts = new Map();
  for (const rule of rules.values()) {
    if (rule.name.startsWith(POPBOX_AUTOMOD_PREFIX)) continue;
    typeCounts.set(rule.triggerType, (typeCounts.get(rule.triggerType) || 0) + 1);
  }
  for (const [triggerType, plannedCount] of plannedOwned) {
    const limit = typeLimits.get(triggerType);
    if ((typeCounts.get(triggerType) || 0) + plannedCount > limit) {
      throw new Error(`Your server already uses the ${typeName(triggerType)} AutoMod rule limit. Review Server Settings → AutoMod or remove an unused rule before setup; existing rules were left unchanged.`);
    }
  }

  let created = 0;
  let updated = 0;
  for (const plan of plannedRules) {
    const result = await upsertNativeAutoModRule(guild, ownedRules, {
      ...plan,
      exemptRoles
    });
    if (result === "created") created += 1;
    else updated += 1;
  }

  const extra = badWords.length === 0
    ? " The custom blocked-word rule was skipped because config/moderation.json has no words yet."
    : "";
  const timeoutNote = canTimeout
    ? " Keyword/mention timeouts are enabled where Discord supports them."
    : " For keyword/mention timeouts, grant the bot Moderate Members and rerun setup.";
  const alertNote = alertChannel?.isTextBased()
    ? ` Alerts go to ${alertChannel}.`
    : " Set `alertChannelId` in config/moderation.json to receive private AutoMod alerts.";
  return {
    message: `✅ Configured Discord's native AutoMod: ${created} created, ${updated} updated, ${rules.size} existing server rules total. Native rules include links/invites, spam content, mention spam, and commonly flagged words.${extra}${timeoutNote}${alertNote} This server supports at most six keyword, one spam, one preset, and one mention-spam rule; the profile badge's 100-rule threshold is across servers, not 100 rules in this server.`
  };
}

function typeName(triggerType) {
  const names = {
    [AutoModerationRuleTriggerType.Keyword]: "keyword",
    [AutoModerationRuleTriggerType.Spam]: "spam",
    [AutoModerationRuleTriggerType.KeywordPreset]: "preset",
    [AutoModerationRuleTriggerType.MentionSpam]: "mention-spam",
    [AutoModerationRuleTriggerType.MemberProfile]: "member-profile"
  };
  return names[triggerType] || "unknown";
}

async function showNativeAutoModStatus(interaction) {
  const rules = await fetchNativeAutoModRules(interaction.guild);
  const ownRules = [...rules.values()].filter(rule => rule.name.startsWith(POPBOX_AUTOMOD_PREFIX));
  const counts = new Map();
  for (const rule of rules.values()) counts.set(rule.triggerType, (counts.get(rule.triggerType) || 0) + 1);
  const lines = [
    `**All Discord rules in this server:** ${rules.size}`,
    `**POPBOX-managed rules:** ${ownRules.length}`,
    `**Keyword:** ${counts.get(AutoModerationRuleTriggerType.Keyword) || 0}/6`,
    `**Spam:** ${counts.get(AutoModerationRuleTriggerType.Spam) || 0}/1`,
    `**Keyword preset:** ${counts.get(AutoModerationRuleTriggerType.KeywordPreset) || 0}/1`,
    `**Mention spam:** ${counts.get(AutoModerationRuleTriggerType.MentionSpam) || 0}/1`,
    "",
    ...ownRules.map(rule => `${rule.enabled ? "🟢" : "⚪"} ${rule.name}`)
  ];
  return interaction.reply({ embeds: [embed("🛡️ Discord AutoMod", lines.join("\n"))], ephemeral: true });
}

async function publishVerificationPanel(guild, config) {
  const roles = getVerificationRoles(guild);
  if (!roles.verified || !roles.unverified) {
    throw new Error("The Verified or Unverified role from config/access-control.json was not found.");
  }

  let channel = config.verificationChannelId
    ? guild.channels.cache.get(config.verificationChannelId)
    : null;
  channel ||= guild.channels.cache.find(item => item.name === "verify" && item.type === ChannelType.GuildText);
  channel ||= await guild.channels.create({ name: "verify", type: ChannelType.GuildText });

  const readOnlyAccess = { ViewChannel: true, ReadMessageHistory: true, SendMessages: false };
  await channel.permissionOverwrites.edit(guild.roles.everyone, readOnlyAccess, "Allow members to access the verification panel");
  await channel.permissionOverwrites.edit(roles.unverified, readOnlyAccess, "Allow unverified members to access the verification panel");
  await channel.permissionOverwrites.edit(roles.verified, readOnlyAccess, "Keep the verification panel read-only for verified members");
  if (guild.members.me) {
    await channel.permissionOverwrites.edit(guild.members.me, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true,
      ManageChannels: true
    }, "Allow the POPBOX bot to publish the verification panel");
  }

  const verificationEmbed = config.embeds?.verification || DEFAULT_CONFIG.embeds.verification;
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(verificationEmbed.color)
      .setTitle(verificationEmbed.title)
      .setDescription(`${verificationEmbed.description}\n\nClick the button below to start Roblox verification.`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("verify:start").setLabel("Verify with Roblox").setStyle(ButtonStyle.Primary)
    )]
  });

  setConfig(guild.id, { ...config, verificationChannelId: channel.id });
  return channel;
}

export function getVerificationRoles(guild) {
  const findRole = config => guild.roles.cache.get(config.id) || guild.roles.cache.find(role => role.name === config.name);
  return {
    verified: findRole(accessControl.roles.verified),
    unverified: findRole(accessControl.roles.unverified),
    member: findRole(accessControl.roles.member)
  };
}

async function changeVerificationForAll(guild, roles, action) {
  const members = await guild.members.fetch();
  const humans = [...members.values()].filter(member => !member.user.bot);
  const previousRoles = humans.map(member => ({
    memberId: member.id,
    hadVerified: member.roles.cache.has(roles.verified.id),
    hadUnverified: member.roles.cache.has(roles.unverified.id),
    hadMember: roles.member ? member.roles.cache.has(roles.member.id) : null
  }));
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < humans.length; index += 5) {
    const batch = humans.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map(async member => {
      if (action === "verify") {
        if (!member.roles.cache.has(roles.verified.id)) await member.roles.add(roles.verified, "Bulk verified by an administrator");
        if (member.roles.cache.has(roles.unverified.id)) await member.roles.remove(roles.unverified, "Bulk verified by an administrator");
        if (roles.member && !member.roles.cache.has(roles.member.id)) await member.roles.add(roles.member, "Granted Members role after bulk verification");
      } else {
        if (!member.roles.cache.has(roles.unverified.id)) await member.roles.add(roles.unverified, "Bulk unverified by an administrator");
        if (member.roles.cache.has(roles.verified.id)) await member.roles.remove(roles.verified, "Bulk unverified by an administrator");
        if (roles.member && member.roles.cache.has(roles.member.id)) await member.roles.remove(roles.member, "Removed Members role after bulk unverification");
      }
    }));
    for (const result of results) {
      if (result.status === "fulfilled") updated += 1;
      else failed += 1;
    }
  }

  recordAdminAction(guild.id, action, {
    verifiedRoleId: roles.verified.id,
    unverifiedRoleId: roles.unverified.id,
    members: previousRoles
  });
  return { total: humans.length, updated, failed };
}

async function requestVerificationForAll(guild, verifiedRole) {
  const members = await guild.members.fetch();
  const targets = [...members.values()].filter(member => !member.user.bot && !member.roles.cache.has(verifiedRole.id));
  let sent = 0;
  let failed = 0;
  const states = [];
  const sentMemberIds = [];

  for (let index = 0; index < targets.length; index += 5) {
    const batch = targets.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map(async member => {
      const url = createVerification(member.id);
      const state = new URL(url).searchParams.get("state");
      if (state) states.push(state);
      const button = new ButtonBuilder()
        .setLabel("Verify Roblox account")
        .setStyle(ButtonStyle.Link)
        .setURL(url);
      await member.send({
        embeds: [embed("🔐 POPBOX Roblox Verification", "Please verify your Roblox account to unlock the member channels. This personal link is for your Discord account only.")],
        components: [new ActionRowBuilder().addComponents(button)]
      });
      return member.id;
    }));
    for (const result of results) {
      if (result.status === "fulfilled") {
        sent += 1;
        sentMemberIds.push(result.value);
      }
      else failed += 1;
    }
  }

  recordAdminAction(guild.id, "requestverify", { states, sentMemberIds });
  return { total: targets.length, sent, failed };
}

function normalizeChannelName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectorMatches(channel, selector) {
  const channelName = normalizeChannelName(channel.name);
  const parentName = normalizeChannelName(channel.parent?.name || "");
  const target = normalizeChannelName(selector.match);
  const names = [channelName, parentName];

  if (selector.matchType === "category") {
    return (channel.type === ChannelType.GuildCategory && channelName.includes(target)) || parentName.includes(target);
  }
  if (selector.matchType === "prefix") {
    const hasSeparator = selector.match.endsWith("-");
    return channelName.startsWith(target) && (!hasSeparator || channelName.length > target.length);
  }
  if (selector.matchType === "exact") return channelName === target;
  return names.some(name => name.includes(target));
}

function overwriteFor(channel, policy) {
  const permissions = {
    ViewChannel: Boolean(policy.view),
    ReadMessageHistory: Boolean(policy.view)
  };

  if (channel.type !== ChannelType.GuildCategory && channel.isTextBased?.()) {
    permissions.SendMessages = Boolean(policy.send);
    permissions.SendMessagesInThreads = Boolean(policy.send);
  }
  if (channel.isVoiceBased?.()) {
    permissions.Connect = Boolean(policy.connect);
    permissions.Speak = Boolean(policy.speak);
  }
  return permissions;
}

async function applyChannelAccessPolicy(guild, verificationRoles, memberRole) {
  const channels = await guild.channels.fetch();
  const rules = accessControl.channelPolicy;
  let updated = 0;
  let preserved = 0;
  let failed = 0;
  const previousOverwrites = [];

  for (const channel of channels.values()) {
    if (!channel?.permissionOverwrites) continue;
    const rule = rules.channels.find(selector => selectorMatches(channel, { matchType: selector.matchType || "contains", match: selector.match }));
    if (rule?.preserve || rules.preserveChannels.some(selector => selectorMatches(channel, selector))) {
      preserved += 1;
      continue;
    }
    const verifiedPolicy = { ...rules.defaultVerified, ...(rule?.verified || {}) };
    const unverifiedPolicy = { ...rules.defaultUnverified, ...(rule?.unverified || {}) };
    const roleOverwrites = {};
    for (const role of [memberRole, verificationRoles.unverified, verificationRoles.verified]) {
      const overwrite = channel.permissionOverwrites.cache.get(role.id);
      roleOverwrites[role.id] = overwrite ? {
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString()
      } : null;
    }
    previousOverwrites.push({ channelId: channel.id, roles: roleOverwrites });

    try {
      await channel.permissionOverwrites.edit(memberRole, { ViewChannel: false }, "POPBOX access resetup: restrict the general Members role");
      await channel.permissionOverwrites.edit(verificationRoles.unverified, overwriteFor(channel, unverifiedPolicy), "POPBOX access resetup: Unverified role policy");
      await channel.permissionOverwrites.edit(verificationRoles.verified, overwriteFor(channel, verifiedPolicy), "POPBOX access resetup: Verified role policy");
      updated += 1;
    } catch (error) {
      console.error(`Could not update access on ${channel.name} (${channel.id}):`, error);
      failed += 1;
    }
  }

  recordAdminAction(guild.id, "resetup", { channels: previousOverwrites });
  return { updated, preserved, failed };
}

async function undoAdminAction(guild, action) {
  const payload = JSON.parse(action.payload);
  if (action.action === "verify" || action.action === "unverify") {
    const roles = getVerificationRoles(guild);
    if (!roles.verified || !roles.unverified) return { complete: false, message: "A verification role no longer exists." };
    let restored = 0;
    let failed = 0;
    for (const previous of payload.members || []) {
      try {
        const member = await guild.members.fetch(previous.memberId).catch(() => null);
        if (!member) continue;
        await reconcileRole(member, roles.verified, previous.hadVerified);
        await reconcileRole(member, roles.unverified, previous.hadUnverified);
        if (typeof previous.hadMember === "boolean" && roles.member) await reconcileRole(member, roles.member, previous.hadMember);
        restored += 1;
      } catch {
        failed += 1;
      }
    }
    return { complete: failed === 0, message: `Restored previous verification roles for ${restored}/${payload.members?.length || 0} members${failed ? `; ${failed} failed` : ""}.` };
  }

  if (action.action === "resetup") {
    const channels = await guild.channels.fetch();
    let restored = 0;
    let failed = 0;
    for (const snapshot of payload.channels || []) {
      const channel = channels.get(snapshot.channelId);
      if (!channel?.permissionOverwrites) continue;
      let ok = true;
      for (const [roleId, overwrite] of Object.entries(snapshot.roles || {})) {
        const role = guild.roles.cache.get(roleId);
        if (!role) { if (overwrite !== null) { failed += 1; ok = false; } continue; }
        try {
          if (overwrite === null) await channel.permissionOverwrites.delete(role, "Undo POPBOX access resetup").catch(error => { if (channel.permissionOverwrites.cache.has(roleId)) throw error; });
          else await channel.permissionOverwrites.edit(role, overwriteOptionsFromSnapshot(overwrite), "Undo POPBOX access resetup");
        } catch { failed += 1; ok = false; }
      }
      if (ok) restored += 1;
    }
    return { complete: failed === 0, message: `Restored previous overwrites on ${restored}/${payload.channels?.length || 0} channels${failed ? `; ${failed} failed` : ""}.` };
  }

  if (action.action === "requestverify") {
    const remove = db.prepare("DELETE FROM oauth_states WHERE state = ?");
    const removed = db.transaction(states => states.reduce((total, state) => total + remove.run(state).changes, 0))(payload.states || []);
    return { complete: true, message: `Invalidated ${removed} unused OAuth link(s). Discord cannot retract DMs already delivered.` };
  }
  return { complete: false, message: `Action “${action.action}” is not supported by undo.` };
}

async function reconcileRole(member, role, shouldHave) {
  const hasRole = member.roles.cache.has(role.id);
  if (shouldHave && !hasRole) await member.roles.add(role, "Undo previous POPBOX bulk role action");
  else if (!shouldHave && hasRole) await member.roles.remove(role, "Undo previous POPBOX bulk role action");
}

function overwriteOptionsFromSnapshot(snapshot) {
  const allow = BigInt(snapshot.allow);
  const deny = BigInt(snapshot.deny);
  const permissions = {};
  for (const [name, value] of Object.entries(PermissionFlagsBits)) {
    const bit = BigInt(value);
    permissions[name] = (allow & bit) === bit ? true : (deny & bit) === bit ? false : null;
  }
  return permissions;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function replyRandom(interaction, title, items) {
  return interaction.reply({ embeds: [embed(title, pickRandom(items))] });
}

async function showUserInfo(interaction) {
  const user = interaction.options.getUser("user") || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  const roles = member.roles.cache.filter(role => role.id !== interaction.guild.id).map(role => role.toString()).slice(0, 15);
  const card = new EmbedBuilder().setColor(0x5865F2).setTitle(`👤 ${user.tag}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "User ID", value: user.id, inline: true },
      { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
      { name: "Joined server", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Unknown", inline: true },
      { name: "Roles", value: roles.join(", ") || "None" }
    );
  return interaction.reply({ embeds: [card] });
}

async function showAvatar(interaction) {
  const user = interaction.options.getUser("user") || interaction.user;
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${user.username}'s avatar`).setImage(user.displayAvatarURL({ size: 1024 }))] });
}

async function showBanner(interaction) {
  const requested = interaction.options.getUser("user") || interaction.user;
  const user = await interaction.client.users.fetch(requested.id, { force: true });
  const banner = user.bannerURL({ size: 1024 });
  if (!banner) return interaction.reply({ content: `${user.username} has no profile banner set.`, ephemeral: true });
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${user.username}'s banner`).setImage(banner)] });
}

async function showMemberCount(interaction) {
  const members = await interaction.guild.members.fetch();
  const bots = members.filter(member => member.user.bot).size;
  return interaction.reply({ embeds: [embed(`👥 ${interaction.guild.name} members`, `**Total:** ${interaction.guild.memberCount}\n**Humans:** ${members.size - bots}\n**Bots:** ${bots}`)] });
}

async function showJoined(interaction) {
  const user = interaction.options.getUser("user") || interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  return interaction.reply({ embeds: [embed(`📅 ${user.username} joined`, member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : "Join date unavailable.")] });
}

async function showRoleInfo(interaction) {
  const role = interaction.options.getRole("role");
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(role.color || 0x5865F2).setTitle(`🎭 ${role.name}`)
    .addFields(
      { name: "ID", value: role.id, inline: true },
      { name: "Members", value: String(role.members.size), inline: true },
      { name: "Position", value: String(role.position), inline: true },
      { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
      { name: "Created", value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>`, inline: true }
    )] });
}

function parseHexColor(value, fallback = 0x5865F2) {
  if (!value) return fallback;
  const normalized = value.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(normalized) ? Number.parseInt(normalized, 16) : null;
}

function resolveTextChannel(interaction, optionName = "channel") {
  const channel = interaction.options.getChannel(optionName) || interaction.channel;
  return channel?.isTextBased() && typeof channel.send === "function" ? channel : null;
}

async function sendManagedMessage(interaction, kind) {
  const channel = resolveTextChannel(interaction);
  if (!channel) return interaction.reply({ content: "Choose a text channel that can receive messages.", ephemeral: true });
  let payload;
  if (kind === "say") {
    payload = { content: interaction.options.getString("message"), allowedMentions: { parse: [] } };
  } else {
    const color = kind === "announce" ? 0x5865F2 : parseHexColor(interaction.options.getString("color"));
    if (color === null) return interaction.reply({ content: "Color must be a six-digit hex value such as `#5865F2`.", ephemeral: true });
    const card = new EmbedBuilder().setColor(color).setTitle(interaction.options.getString("title"))
      .setDescription(interaction.options.getString("message")).setTimestamp();
    if (kind === "announce") card.setFooter({ text: `Announcement by ${interaction.user.username}` });
    payload = { embeds: [card], allowedMentions: { parse: [] } };
  }
  const sent = await channel.send(payload);
  return interaction.reply({ content: `✅ Posted in ${sent.channel}.`, ephemeral: true });
}

async function manageRole(interaction) {
  if (interaction.options.getSubcommand() === "create") {
    const color = parseHexColor(interaction.options.getString("color"));
    if (color === null) return interaction.reply({ content: "Color must be a six-digit hex value such as `#5865F2`.", ephemeral: true });
    const role = await interaction.guild.roles.create({ name: interaction.options.getString("name"), color, reason: `Created by ${interaction.user.tag}` });
    return interaction.reply({ content: `✅ Created ${role}.`, ephemeral: true });
  }
  const role = interaction.options.getRole("role");
  if (role.id === interaction.guild.id) return interaction.reply({ content: "The @everyone role cannot be deleted.", ephemeral: true });
  if (!role.editable) return interaction.reply({ content: "I cannot manage that role. Move my bot role above it.", ephemeral: true });
  await role.delete(`Deleted by ${interaction.user.tag}`);
  return interaction.reply({ content: `✅ Deleted **${role.name}**.`, ephemeral: true });
}

async function changeMemberRole(interaction, action) {
  const user = interaction.options.getUser("user");
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const role = interaction.options.getRole("role");
  if (!member) return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  if (!role.editable) return interaction.reply({ content: "I cannot manage that role. Move my bot role above it.", ephemeral: true });
  if (action === "giverole") await member.roles.add(role, `Role granted by ${interaction.user.tag}`);
  else await member.roles.remove(role, `Role removed by ${interaction.user.tag}`);
  return interaction.reply({ content: `✅ ${action === "giverole" ? "Gave" : "Removed"} ${role} ${action === "giverole" ? "to" : "from"} ${member}.`, ephemeral: true });
}

async function setMemberNickname(interaction) {
  const user = interaction.options.getUser("user");
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: "That member is not in this server.", ephemeral: true });
  const nickname = interaction.options.getString("nickname");
  await member.setNickname(nickname, `Nickname updated by ${interaction.user.tag}`);
  return interaction.reply({ content: `✅ Nickname ${nickname ? "updated" : "cleared"} for ${member}.`, ephemeral: true });
}

async function manageChannel(interaction) {
  const action = interaction.options.getSubcommand();
  const channel = interaction.options.getChannel("target") || interaction.channel;
  if (!channel?.permissionOverwrites || !channel.isTextBased()) return interaction.reply({ content: "Choose a text channel.", ephemeral: true });
  const lock = action === "lock";
  await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: !lock }, `Channel ${action} by ${interaction.user.tag}`);
  return interaction.reply({ content: `${lock ? "🔒 Locked" : "🔓 Unlocked"} ${channel}.`, ephemeral: true });
}

async function createPoll(interaction) {
  const question = interaction.options.getString("question").trim();
  const options = interaction.options.getString("options").split(",").map(option => option.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 5 || new Set(options.map(option => option.toLowerCase())).size !== options.length) {
    return interaction.reply({ content: "Enter 2–5 unique choices separated by commas.", ephemeral: true });
  }

  const placeholder = `pending-${interaction.id}`;
  const insert = db.prepare("INSERT INTO polls (guild_id, channel_id, message_id, question, options, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(interaction.guild.id, interaction.channel.id, placeholder, question, JSON.stringify(options), new Date().toISOString());
  const pollId = Number(insert.lastInsertRowid);
  const buttons = options.map((option, index) => new ButtonBuilder().setCustomId(`pollvote:${pollId}:${index}`)
    .setLabel(option.slice(0, 80)).setStyle(ButtonStyle.Primary));
  const pollMessage = await interaction.channel.send({
    embeds: [makePollEmbed(question, options, options.map(() => 0), interaction.user.username)],
    components: [new ActionRowBuilder().addComponents(buttons)]
  });
  db.prepare("UPDATE polls SET message_id = ? WHERE id = ?").run(pollMessage.id, pollId);
  return interaction.reply({ content: `📊 Poll created in ${interaction.channel}.`, ephemeral: true });
}

function makePollEmbed(question, options, counts, creator) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const rows = options.map((option, index) => `**${index + 1}. ${option}** — ${counts[index]} vote${counts[index] === 1 ? "" : "s"}`).join("\n");
  return new EmbedBuilder().setColor(0x5865F2).setTitle(`📊 ${question}`)
    .setDescription(`${rows}\n\nClick a button to vote. You can change your vote later.`)
    .setFooter({ text: `Poll by ${creator} • ${total} total votes` });
}

export async function handlePollVote(interaction) {
  const [, pollText, optionText] = interaction.customId.split(":");
  const pollId = Number(pollText);
  const optionIndex = Number(optionText);
  const poll = db.prepare("SELECT * FROM polls WHERE id = ? AND guild_id = ? AND message_id = ?")
    .get(pollId, interaction.guildId, interaction.message.id);
  if (!poll || poll.closed_at) return interaction.reply({ content: "This poll is unavailable or closed.", ephemeral: true });
  const options = JSON.parse(poll.options);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    return interaction.reply({ content: "That poll choice is invalid.", ephemeral: true });
  }
  db.prepare("INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index")
    .run(pollId, interaction.user.id, optionIndex);
  const counts = options.map((_, index) => db.prepare("SELECT COUNT(*) AS count FROM poll_votes WHERE poll_id = ? AND option_index = ?").get(pollId, index).count);
  const creator = interaction.message.embeds[0]?.footer?.text?.replace(/^Poll by (.+?) •.*$/, "$1") || "POPBOX";
  await interaction.message.edit({ embeds: [makePollEmbed(poll.question, options, counts, creator)] });
  return interaction.reply({ content: `Your vote for **${options[optionIndex]}** has been recorded.`, ephemeral: true });
}

async function sendServerInfo(interaction) {
  const guild = interaction.guild;
  await guild.members.fetch();

  const channels = [...guild.channels.cache.values()];
  const categories = channels.filter(channel => channel.type === ChannelType.GuildCategory);
  const visibleChannels = channels.filter(channel => channel.type !== ChannelType.GuildCategory);
  const channelLines = visibleChannels
    .sort((a, b) => a.position - b.position)
    .map(channel => `${channel.parent ? `${channel.parent.name} / ` : ""}${channel.name} (${channel.type})`);
  const roleLines = [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(role => `${role.name} (${role.id})`);
  const members = guild.members.cache;
  const bots = members.filter(member => member.user.bot).size;
  const humans = members.size - bots;
  const owner = await guild.fetchOwner().catch(() => null);
  const description = [
    `**Owner:** ${owner ? `${owner.user.tag} (${owner.id})` : "Unknown"}`,
    `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
    `**Members:** ${members.size} total (${humans} humans, ${bots} bots)`,
    `**Channels:** ${visibleChannels.length} (${categories.length} categories)`,
    `**Roles:** ${roleLines.length}`,
    "",
    `**Channels**\n${channelLines.length ? channelLines.join("\n") : "None"}`,
    "",
    `**Roles**\n${roleLines.length ? roleLines.join("\n") : "None"}`
  ].join("\n");

  const pages = [];
  for (let index = 0; index < description.length; index += 3900) pages.push(description.slice(index, index + 3900));
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 ${guild.name}`).setDescription(pages[0])] });
  for (const page of pages.slice(1)) await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(page)] });
}

async function sendRolePanel(interaction) {
  const cfg = { ...DEFAULT_CONFIG, ...getConfig(interaction.guild.id) };
  const roles = Object.entries(socialConfig.platforms)
    .filter(([key, platform]) => platform.enabled && interaction.guild.roles.cache.has(cfg.notificationRoles?.[key]))
    .map(([key, platform]) => [key, platform.label]);
  if (!roles.length) {
    return interaction.reply({ content: "Social notification roles are not set up yet. Ask an administrator to run `/social setup`.", ephemeral: true });
  }
  const menu = new StringSelectMenuBuilder().setCustomId("roles:select").setPlaceholder("Choose notification roles").setMinValues(0).setMaxValues(roles.length)
    .addOptions(roles.map(([value,label])=>({label, value, description:`Get ${label} notifications`, default: interaction.member.roles.cache.has(cfg.notificationRoles[value])})));
  return interaction.reply({ embeds:[embed("🔔 Notification Roles","Select all the platform notifications you want. Your current choices are preselected; submit the menu to update them.")], components:[new ActionRowBuilder().addComponents(menu)] });
}

async function sendTicketPanel(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:general").setLabel("General Support").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket:report").setLabel("Report").setStyle(ButtonStyle.Danger)
  );
  return interaction.reply({ embeds:[embed("🎫 POPBOX Support","Need help? Choose a ticket type below.")], components:[row] });
}

async function sendApplicationPanel(interaction) {
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("application:start").setLabel("Apply to POPBOX").setStyle(ButtonStyle.Primary));
  return interaction.reply({ embeds:[embed("📝 POPBOX Interactive Application","Tell us what you can do, why you want to work with POPBOX, and then upload your portfolio in the private application channel.")], components:[row] });
}
