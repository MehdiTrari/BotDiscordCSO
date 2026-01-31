const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const {
  addLog,
  getLogs,
  clearLogs,
  loadLogsPinData,
  saveLogsPinData,
  clearLogsPinData,
  buildLogsComponents,
} = require("../logs-utils");

const EMBED_COLOR = 0xb10f0f;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Afficher les logs du bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("display").setDescription("Afficher les logs (auto-refresh)")
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Retirer le panneau de logs")
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Effacer tous les logs")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "clear") {
      clearLogs();
      await interaction.reply({ content: "✅ Logs effacés.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "stop") {
      const pinData = loadLogsPinData();
      if (!pinData) {
        await interaction.reply({ content: "❌ Aucun panneau de logs épinglé.", flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        const channel = await interaction.client.channels.fetch(pinData.channelId);
        if (channel) {
          const msg = await channel.messages.fetch(pinData.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      } catch {
        // ignore
      }
      clearLogsPinData();
      await interaction.reply({ content: "✅ Panneau de logs retiré.", flags: MessageFlags.Ephemeral });
      return;
    }

    // /logs display
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Supprimer l'ancien panneau s'il existe
      const oldPin = loadLogsPinData();
      if (oldPin) {
        try {
          const oldChannel = await interaction.client.channels.fetch(oldPin.channelId);
          if (oldChannel) {
            const oldMsg = await oldChannel.messages.fetch(oldPin.messageId).catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => {});
          }
        } catch {}
      }

      const components = buildLogsComponents();
      const pinnedMsg = await interaction.channel.send({
        components,
        flags: MessageFlags.IsComponentsV2,
      });

      saveLogsPinData({
        channelId: interaction.channel.id,
        messageId: pinnedMsg.id,
        guildId: interaction.guild.id,
      });

      await interaction.editReply("✅ Panneau de logs créé !");
    } catch (error) {
      console.error("Error creating logs panel:", error);
      await interaction.editReply("❌ Erreur lors de la création du panneau de logs.");
    }
  },
};
