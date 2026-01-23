const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const { token, clientId } = require("./config");
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("DISCORD_TOKEN ou DISCORD_CLIENT_ID manquant dans .env");
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ("data" in command) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("🔄 Enregistrement des commandes slash...");
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ Commandes enregistrées pour le serveur ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("✅ Commandes enregistrées globalement.");
      console.log("ℹ️ Les commandes globales peuvent prendre du temps à apparaître.");
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
