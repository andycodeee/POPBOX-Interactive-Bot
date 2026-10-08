export const DEFAULT_CONFIG = {
  verifiedRoleId: null,
  unverifiedRoleId: null,
  welcomeChannelId: null,
  verificationChannelId: null,
  ticketCategoryId: null,
  ticketPanelChannelId: null,
  applicationChannelId: null,
  notificationChannelId: null,
  logChannelId: null,
  logChannels: {},
  notificationRoles: {
    x: null
  },
  embeds: {
    welcome: {
      title: "👋 Welcome to POPBOX Interactive!",
      description: "Welcome {user}! Please verify your Roblox account to access the community.",
      color: 0x5865F2
    },
    verification: {
      title: "🔐 POPBOX Interactive Verification",
      description: "Verify your Roblox account to unlock the server.",
      color: 0x5865F2
    }
  }
};
