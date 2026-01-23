const { REST, Routes } = require("discord.js");
const { token, clientId } = require("./config");

if (!token || !clientId) {
  console.error("DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant dans .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🧹 Suppression des commandes globales...");
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log("✅ Commandes globales supprimées.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
