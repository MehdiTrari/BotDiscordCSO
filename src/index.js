const { Client, Collection, GatewayIntentBits, Events, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const { token } = require("./config");
const { refreshLeaderboard, loadPinData, loadData, saveData, parseRiotId, resolvePuuid } = require("./leaderboard");

// Import du système de logs
const logsCommand = require("./commands/logs");
const { addLog, loadLogsPinData, buildLogsComponents } = logsCommand;

// Intercepter les console.log pour les stocker
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  originalLog(...args);
  const message = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  addLog(message, "info");
};

console.error = (...args) => {
  originalError(...args);
  const message = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  addLog(message, "error");
};

console.warn = (...args) => {
  originalWarn(...args);
  const message = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  addLog(message, "warn");
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers] });

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[WARN] Command in ${filePath} is missing data or execute.`);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Connecté en tant que ${readyClient.user.tag}`);
  const refreshIntervalMs = 10 * 60 * 1000; // 10 minutes
  let isRefreshing = false;

  const runRefresh = async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const snapshot = await refreshLeaderboard();
      console.log(`[Leaderboard] Refresh ok (${snapshot.items.length} joueurs).`);
      
      // Update pinned message if exists
      const pinData = loadPinData();
      if (pinData) {
        try {
          const channel = await readyClient.channels.fetch(pinData.channelId);
          if (channel) {
            const msg = await channel.messages.fetch(pinData.messageId).catch(() => null);
            if (msg) {
              const guild = await readyClient.guilds.fetch(pinData.guildId);
              const data = loadData();
              // Récupérer les membres du serveur pour avoir leur displayName (pseudo serveur)
              const nameMap = {};
              for (const entry of data.entries) {
                try {
                  const member = await guild.members.fetch(entry.discordId);
                  nameMap[entry.discordId] = member.displayName;
                } catch {
                  // Membre pas trouvé, utiliser le discordTag ou gameName
                  nameMap[entry.discordId] = entry.discordTag || entry.gameName;
                }
              }
              const updatedAt = new Date(snapshot.updatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
              const components = await buildPinnedComponents(snapshot.items, updatedAt, nameMap, guild);
              await msg.edit({ components, flags: MessageFlags.IsComponentsV2 });
              console.log("[Leaderboard] Pinned message updated.");
            }
          }
        } catch (err) {
          console.error("[Leaderboard] Failed to update pinned message:", err.message);
        }
      }
    } catch (error) {
      console.error("Leaderboard refresh error:", error);
    } finally {
      isRefreshing = false;
    }
  };

  // Fonction pour mettre à jour le panneau de logs
  const updateLogsPanel = async () => {
    const logsPinData = loadLogsPinData();
    if (!logsPinData) return;
    
    try {
      const channel = await readyClient.channels.fetch(logsPinData.channelId);
      if (channel) {
        const msg = await channel.messages.fetch(logsPinData.messageId).catch(() => null);
        if (msg) {
          const components = buildLogsComponents();
          await msg.edit({ components, flags: MessageFlags.IsComponentsV2 });
        }
      }
    } catch {
      // ignore silently to avoid log spam
    }
  };

  // Mettre à jour le panneau de logs toutes les 5 secondes
  setInterval(updateLogsPanel, 5000);

  runRefresh();
  setInterval(runRefresh, refreshIntervalMs);
});

// Components V2 builder for pinned message updates
const RANK_EMOJI_PATH = path.join(__dirname, "data", "rank-emojis.json");
const EMBED_COLOR = 0xb10f0f;
const TIER_ORDER = ["IRON","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","MASTER","GRANDMASTER","CHALLENGER"];
const RANK_ORDER = ["IV", "III", "II", "I"];
const MASTER_INDEX = TIER_ORDER.indexOf("MASTER");

function loadRankEmojis() {
  try {
    const raw = fs.readFileSync(RANK_EMOJI_PATH, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch { return {}; }
}

async function resolveRankEmojisForGuild(guild) {
  const rankEmojis = loadRankEmojis();
  const resolved = {};
  if (!guild) return resolved;
  try {
    const emojis = await guild.emojis.fetch();
    for (const [tier, value] of Object.entries(rankEmojis)) {
      const name = value.replace(/^:/, "").replace(/:$/, "");
      const match = emojis.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (match) resolved[tier] = `<:${match.name}:${match.id}>`;
    }
  } catch {}
  return resolved;
}

function buildOpggUrl(gameName, tagLine) {
  let name = gameName || "";
  let tag = tagLine || "";
  if (name.includes('#')) {
    const parts = name.split('#');
    name = parts[0];
    tag = tag || parts[1] || "";
  }
  return `https://op.gg/fr/lol/summoners/euw/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;
}

function compareEntries(a, b) {
  const tierA = TIER_ORDER.indexOf(a.tier || "");
  const tierB = TIER_ORDER.indexOf(b.tier || "");
  if (tierA !== tierB) return tierB - tierA;
  if (tierA < 0) return 0;
  if (tierA >= MASTER_INDEX) return (b.lp || 0) - (a.lp || 0);
  const rankA = RANK_ORDER.indexOf(a.rank || "");
  const rankB = RANK_ORDER.indexOf(b.rank || "");
  if (rankA !== rankB) return rankB - rankA;
  return (b.lp || 0) - (a.lp || 0);
}

async function buildPinnedComponents(items, updatedAt, nameMap, guild) {
  const rankEmojis = await resolveRankEmojisForGuild(guild);
  const data = loadData();
  const sortedEntries = [...items].sort(compareEntries);
  const lines = [];
  
  for (const [index, entry] of sortedEntries.entries()) {
    const rankIndex = index + 1;
    let rankLabel = "Unranked";
    if (entry.tier !== "UNRANKED") {
      const displayTier = entry.tier === "GRANDMASTER" ? "GM" 
        : entry.tier === "CHALLENGER" ? "Chall"
        : entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
      if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier)) {
        rankLabel = `${displayTier} ${entry.lp} LP`;
      } else {
        rankLabel = `${displayTier} ${entry.rank} ${entry.lp} LP`;
      }
    }
    const emoji = rankEmojis[entry.tier] || "";
    
    // Récupérer le discordTag depuis entries
    const dataEntry = data.entries.find(e => e.discordId === entry.discordId);
    const discordTag = dataEntry?.discordTag || "";
    const displayName = nameMap[entry.discordId] || discordTag || entry.gameName || "Inconnu";
    const gameName = dataEntry?.gameName || entry.gameName || "";
    const tagLine = dataEntry?.tagLine || entry.tagLine || "";
    const opggUrl = buildOpggUrl(gameName, tagLine);
    const playerLink = gameName ? `[${displayName}](${opggUrl})` : displayName;
    
    const rankWithEmoji = emoji ? `${emoji} ${rankLabel}` : rankLabel;
    lines.push(`${rankIndex}- ${playerLink} • ${rankWithEmoji}`);
  }
  
  let content = lines.join("\n");
  if (content.length > 3900) content = content.slice(0, 3900) + "\n...";
  
  const container = new ContainerBuilder()
    .setAccentColor(EMBED_COLOR)
    .addTextDisplayComponents(td => td.setContent("## CSO SoloQ Leaderboard"))
    .addSeparatorComponents(sep => sep.setDivider(true))
    .addTextDisplayComponents(td => td.setContent(content))
    .addSeparatorComponents(sep => sep.setDivider(true))
    .addTextDisplayComponents(td => td.setContent(`*Mise à jour: ${updatedAt}*`));
  
  return [container];
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle button interactions
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }

  // Handle slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`Aucune commande trouvée: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "Erreur lors de l'exécution de la commande.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Erreur lors de l'exécution de la commande.", ephemeral: true });
    }
  }
});

// Button interaction handler
async function handleButtonInteraction(interaction) {
  const { customId } = interaction;

  if (customId === "lol_link") {
    // Show modal to link account
    const modal = new ModalBuilder()
      .setCustomId("lol_link_modal")
      .setTitle("Lier votre compte Riot");

    const riotIdInput = new TextInputBuilder()
      .setCustomId("riot_id")
      .setLabel("Votre Riot ID (format: Pseudo#TAG)")
      .setPlaceholder("Ex: MonPseudo#EUW")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(50);

    const row = new ActionRowBuilder().addComponents(riotIdInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
    return;
  }

  if (customId === "lol_unlink") {
    await interaction.deferReply({ ephemeral: true });
    
    const data = loadData();
    const existing = data.entries.find((e) => e.discordId === interaction.user.id);
    
    if (!existing) {
      await interaction.editReply("❌ Vous n'avez pas de compte lié.");
      return;
    }

    data.entries = data.entries.filter((e) => e.discordId !== interaction.user.id);
    data.snapshot = null;
    saveData(data);
    
    await interaction.editReply("✅ Votre compte a été délié du leaderboard.");
    return;
  }

  if (customId === "lol_refresh") {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const snapshot = await refreshLeaderboard();
      await interaction.editReply(`✅ Leaderboard rafraîchi ! (${snapshot.items.length} joueurs)`);
    } catch (error) {
      console.error("Refresh error:", error);
      await interaction.editReply("❌ Erreur lors du rafraîchissement.");
    }
    return;
  }

  if (customId === "lol_leaderboard") {
    await interaction.deferReply({ ephemeral: true });
    
    const data = loadData();
    if (!data.entries.length) {
      await interaction.editReply("📋 Le leaderboard est vide. Soyez le premier à lier votre compte !");
      return;
    }

    try {
      const snapshot = data.snapshot || await refreshLeaderboard();
      const updatedAt = new Date(snapshot.updatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
      const guild = interaction.guild;
      const rankEmojis = await resolveRankEmojisForGuild(guild);
      
      // Récupérer les membres du serveur pour avoir leur displayName (pseudo serveur)
      const nameMap = {};
      for (const entry of data.entries) {
        try {
          const member = await guild.members.fetch(entry.discordId);
          nameMap[entry.discordId] = member.displayName;
        } catch {
          nameMap[entry.discordId] = entry.discordTag || entry.gameName;
        }
      }
      
      const components = await buildPinnedComponents(snapshot.items, updatedAt, nameMap, guild);
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      console.error("Leaderboard error:", error);
      await interaction.editReply("❌ Erreur lors de l'affichage du leaderboard.");
    }
    return;
  }
}

// Modal submit handler
async function handleModalSubmit(interaction) {
  if (interaction.customId === "lol_link_modal") {
    await interaction.deferReply({ ephemeral: true });

    const riotIdRaw = interaction.fields.getTextInputValue("riot_id");
    const riotId = parseRiotId(riotIdRaw);

    if (!riotId) {
      await interaction.editReply("❌ Format invalide. Utilisez le format `Pseudo#TAG` (ex: MonPseudo#EUW)");
      return;
    }

    // Check if already linked
    const data = loadData();
    const existingUser = data.entries.find((e) => e.discordId === interaction.user.id);
    
    // Resolve PUUID from Riot API
    let puuid;
    try {
      puuid = await resolvePuuid(riotId.gameName, riotId.tagLine);
    } catch (error) {
      if (error.status === 404) {
        await interaction.editReply("❌ Compte Riot introuvable. Vérifiez votre Riot ID (Pseudo#TAG).");
        return;
      }
      console.error("Riot API error:", error);
      await interaction.editReply("❌ Erreur lors de la vérification du compte.");
      return;
    }

    // Check if this Riot account is already linked to another user
    const existingRiot = data.entries.find((e) => e.puuid === puuid && e.discordId !== interaction.user.id);
    if (existingRiot) {
      await interaction.editReply("❌ Ce compte Riot est déjà lié à un autre utilisateur.");
      return;
    }

    const payload = {
      discordId: interaction.user.id,
      discordTag: interaction.user.username,
      gameName: riotId.gameName,
      tagLine: riotId.tagLine,
      puuid,
      addedAt: new Date().toISOString(),
    };

    if (existingUser) {
      Object.assign(existingUser, payload);
    } else {
      data.entries.push(payload);
    }

    data.snapshot = null;
    saveData(data);

    await interaction.editReply(`✅ Compte lié avec succès !\n🎮 **${riotId.gameName}#${riotId.tagLine}**\n\nVotre rang sera mis à jour automatiquement.`);
    return;
  }
}

if (!token) {
  console.error("DISCORD_TOKEN manquant dans .env");
  process.exit(1);
}

client.login(token);
