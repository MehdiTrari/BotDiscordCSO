const {
  SlashCommandBuilder,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const EMBED_COLOR = 0xb10f0f;
const LOGS_PIN_PATH = path.join(__dirname, "..", "data", "logs-pin.json");
const MAX_LOGS = 30; // Nombre max de logs à afficher

// Stockage des logs en mémoire
const logsBuffer = [];

function addLog(message, type = "info") {
  const timestamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const emoji = type === "error" ? "❌" : type === "warn" ? "⚠️" : "📝";
  logsBuffer.push({ timestamp, message, emoji });
  
  // Garder seulement les X derniers logs
  if (logsBuffer.length > MAX_LOGS) {
    logsBuffer.shift();
  }
}

function getLogs() {
  return [...logsBuffer];
}

function clearLogs() {
  logsBuffer.length = 0;
}

function loadLogsPinData() {
  try {
    const raw = fs.readFileSync(LOGS_PIN_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLogsPinData(data) {
  fs.mkdirSync(path.dirname(LOGS_PIN_PATH), { recursive: true });
  fs.writeFileSync(LOGS_PIN_PATH, JSON.stringify(data, null, 2), "utf8");
}

function clearLogsPinData() {
  try {
    fs.unlinkSync(LOGS_PIN_PATH);
  } catch {
    // ignore
  }
}

function buildLogsComponents() {
  const logs = getLogs();
  const updatedAt = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  
  let content = "";
  if (logs.length === 0) {
    content = "*Aucun log pour le moment...*";
  } else {
    content = logs
      .map((log) => `${log.emoji} \`${log.timestamp}\` ${log.message}`)
      .join("\n");
  }
  
  // Tronquer si trop long
  if (content.length > 3900) {
    content = content.slice(-3900);
    const firstNewline = content.indexOf("\n");
    if (firstNewline > 0) {
      content = "...\n" + content.slice(firstNewline + 1);
    }
  }
  
  const container = new ContainerBuilder()
    .setAccentColor(EMBED_COLOR)
    .addTextDisplayComponents((td) => td.setContent("## 📋 Logs du Bot"))
    .addSeparatorComponents((sep) => sep.setDivider(true))
    .addTextDisplayComponents((td) => td.setContent(content))
    .addSeparatorComponents((sep) => sep.setDivider(true))
    .addTextDisplayComponents((td) => td.setContent(`*Dernière mise à jour: ${updatedAt}*`));
  
  return [container];
}

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
      await interaction.reply({ content: "✅ Logs effacés.", ephemeral: true });
      return;
    }

    if (subcommand === "stop") {
      const pinData = loadLogsPinData();
      if (!pinData) {
        await interaction.reply({ content: "❌ Aucun panneau de logs épinglé.", ephemeral: true });
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
      await interaction.reply({ content: "✅ Panneau de logs retiré.", ephemeral: true });
      return;
    }

    // /logs display
    await interaction.deferReply({ ephemeral: true });

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

  // Exports pour utilisation dans index.js
  addLog,
  getLogs,
  clearLogs,
  loadLogsPinData,
  buildLogsComponents,
};
