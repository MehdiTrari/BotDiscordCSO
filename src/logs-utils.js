const fs = require("node:fs");
const path = require("node:path");
const { ContainerBuilder } = require("discord.js");

const EMBED_COLOR = 0xb10f0f;
const LOGS_PIN_PATH = path.join(__dirname, "data", "logs-pin.json");
const MAX_LOGS = 30;

// Stockage des logs en mémoire
const logsBuffer = [];

function addLog(message, type = "info") {
  const timestamp = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const emoji = type === "error" ? "❌" : type === "warn" ? "⚠️" : "📝";
  logsBuffer.push({ timestamp, message, emoji });
  
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
  addLog,
  getLogs,
  clearLogs,
  loadLogsPinData,
  saveLogsPinData,
  clearLogsPinData,
  buildLogsComponents,
};
