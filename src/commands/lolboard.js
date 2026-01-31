const { SlashCommandBuilder, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, MessageFlags } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const {
  loadData,
  saveData,
  parseRiotId,
  refreshLeaderboard,
  resolvePuuid,
  loadPinData,
  savePinData,
  clearPinData,
} = require("../leaderboard");

const RANK_EMOJI_PATH = path.join(__dirname, "..", "data", "rank-emojis.json");
const EMBED_COLOR = 0xb10f0f;
const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];
const RANK_ORDER = ["IV", "III", "II", "I"];
const MASTER_INDEX = TIER_ORDER.indexOf("MASTER");

function loadRankEmojis() {
  try {
    const raw = fs.readFileSync(RANK_EMOJI_PATH, "utf8");
    const cleaned = raw.replace(/^\uFEFF/, "");
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

function compareEntries(a, b) {
  const tierA = TIER_ORDER.indexOf(a.tier || "");
  const tierB = TIER_ORDER.indexOf(b.tier || "");
  if (tierA !== tierB) return tierB - tierA;
  if (tierA < 0) return 0;
  if (tierA >= MASTER_INDEX) {
    return (b.lp || 0) - (a.lp || 0);
  }
  const rankA = RANK_ORDER.indexOf(a.rank || "");
  const rankB = RANK_ORDER.indexOf(b.rank || "");
  if (rankA !== rankB) return rankB - rankA;
  return (b.lp || 0) - (a.lp || 0);
}

function formatPlayerName(value) {
  const trimmed = value.toString().trim();
  if (!trimmed) return "Inconnu";
  return trimmed;
}

function buildOpggUrl(gameName, tagLine) {
  let name = gameName || "";
  let tag = tagLine || "";
  
  // Si gameName contient déjà le #tag, on le sépare
  if (name.includes('#')) {
    const parts = name.split('#');
    name = parts[0];
    tag = tag || parts[1] || "";
  }
  
  const encodedName = encodeURIComponent(name);
  const encodedTag = encodeURIComponent(tag);
  return `https://op.gg/fr/lol/summoners/euw/${encodedName}-${encodedTag}`;
}

function normalizeEmojiName(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("<:") || trimmed.startsWith("<a:")) return trimmed;
  return trimmed.replace(/^:/, "").replace(/:$/, "");
}

function scoreEntry(entry) {
  if (!entry || entry.tier === "UNRANKED") return -1;
  const tierIndex = TIER_ORDER.indexOf(entry.tier);
  let rankIndex = RANK_ORDER.indexOf(entry.rank);
  if (rankIndex < 0 && ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier)) {
    rankIndex = RANK_ORDER.length - 1;
  }
  if (tierIndex < 0 || rankIndex < 0) return -1;
  return tierIndex * 1000 + rankIndex * 100 + (entry.lp || 0);
}



async function resolveRankEmojis(guild) {
  const rankEmojis = loadRankEmojis();
  const resolved = {};
  const names = Object.entries(rankEmojis).reduce((acc, [tier, value]) => {
    const normalized = normalizeEmojiName(value);
    if (normalized && !normalized.startsWith("<:") && !normalized.startsWith("<a:")) {
      acc[tier] = normalized;
    } else if (normalized) {
      resolved[tier] = normalized;
    }
    return acc;
  }, {});

  if (!guild) return resolved;

  try {
    const emojis = guild.emojis.cache.size
      ? guild.emojis.cache
      : await guild.emojis.fetch();
    for (const [tier, name] of Object.entries(names)) {
      const match = emojis.find(
        (emoji) => emoji.name === name || emoji.name.toLowerCase() === name.toLowerCase()
      );
      if (match) resolved[tier] = `<:${match.name}:${match.id}>`;
    }
  } catch {
    // Ignore fetch errors; fall back to empty emoji.
  }

  return resolved;
}

function buildComponents(entries, updatedAt, rankEmojis, nameMap, dataEntries) {
  const sortedEntries = [...entries].sort(compareEntries);
  const lines = [];

  for (const [index, entry] of sortedEntries.entries()) {
    const rankIndex = index + 1;
    
    // Rank label
    let rankLabel = "Unranked";
    if (entry.tier !== "UNRANKED") {
      const displayTier =
        entry.tier === "GRANDMASTER"
          ? "GM"
          : entry.tier === "CHALLENGER"
          ? "Chall"
          : entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
      if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier)) {
        rankLabel = `${displayTier} ${entry.lp} LP`;
      } else {
        rankLabel = `${displayTier} ${entry.rank} ${entry.lp} LP`;
      }
    }
    
    const emoji = rankEmojis[entry.tier] || "";

    // Player name - récupérer le discordTag depuis dataEntries
    const dataEntry = dataEntries?.find(e => e.discordId === entry.discordId);
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lolboard")
    .setDescription("Gérer le leaderboard LoL SoloQ")
    .addSubcommand((sub) =>
      sub.setName("display").setDescription("Afficher le leaderboard (auto-refresh 20 min)")
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Retirer le leaderboard épinglé")
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Ajouter un compte LoL à un membre")
        .addUserOption((option) =>
          option.setName("membre").setDescription("Membre du serveur").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("pseudo")
            .setDescription("Pseudo Riot au format Nom#Tag (ex: jean#sarko)")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("kick")
        .setDescription("Retirer un membre du leaderboard")
        .addUserOption((option) =>
          option.setName("membre").setDescription("Membre du serveur").setRequired(true)
        )
    ),
  async execute(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();

    // /lolboard add @user pseudo#tag
    if (subcommand === "add") {
      const member = interaction.options.getUser("membre");
      const pseudoInput = interaction.options.getString("pseudo");
      const riotId = parseRiotId(pseudoInput);

      if (!riotId) {
        await interaction.editReply("❌ Format invalide. Utilise `Nom#Tag` (ex: jean#sarko).");
        return;
      }

      let puuid = null;
      try {
        puuid = await resolvePuuid(riotId.gameName, riotId.tagLine);
      } catch (error) {
        if (error.status === 404) {
          await interaction.editReply("❌ Compte introuvable. Vérifie le Riot ID (Nom#Tag).");
          return;
        }
        console.error("Riot API error:", error);
        await interaction.editReply("❌ Erreur lors de la liaison du compte.");
        return;
      }

      const data = loadData();
      const existing = data.entries.find((entry) => entry.discordId === member.id);
      const payload = {
        discordId: member.id,
        discordTag: member.username,
        gameName: riotId.gameName,
        tagLine: riotId.tagLine,
        puuid,
        addedAt: new Date().toISOString(),
      };

      if (existing) {
        Object.assign(existing, payload);
      } else {
        data.entries.push(payload);
      }

      data.snapshot = null;
      saveData(data);
      await interaction.editReply(
        `✅ <@${member.id}> lié à **${riotId.gameName}#${riotId.tagLine}**`
      );
      return;
    }

    // /lolboard kick @user
    if (subcommand === "kick") {
      const member = interaction.options.getUser("membre");
      const data = loadData();
      const before = data.entries.length;
      data.entries = data.entries.filter((entry) => entry.discordId !== member.id);
      if (data.entries.length === before) {
        await interaction.editReply("❌ Ce membre n'est pas dans le leaderboard.");
        return;
      }
      data.snapshot = null;
      saveData(data);
      await interaction.editReply(`✅ <@${member.id}> retiré du leaderboard.`);
      return;
    }

    // /lolboard stop
    if (subcommand === "stop") {
      const pinData = loadPinData();
      if (!pinData) {
        await interaction.editReply("❌ Aucun leaderboard épinglé.");
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
      clearPinData();
      await interaction.editReply("✅ Leaderboard retiré.");
      return;
    }

    // /lolboard display (ou /lolboard tout court)
    const data = loadData();
    if (!data.entries.length) {
      await interaction.editReply("📋 Leaderboard vide. Ajoute un membre avec `/lolboard add` ou utilise le panel.");
      return;
    }

    try {
      const snapshot = await refreshLeaderboard();
      const updatedAt = new Date(snapshot.updatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
      const rankEmojis = await resolveRankEmojis(interaction.guild);
      
      // Récupérer les membres du serveur pour avoir leur displayName (pseudo serveur)
      const nameMap = {};
      for (const entry of data.entries) {
        try {
          const member = await interaction.guild.members.fetch(entry.discordId);
          nameMap[entry.discordId] = member.displayName;
        } catch {
          // Membre pas trouvé, utiliser le discordTag ou gameName
          nameMap[entry.discordId] = entry.discordTag || entry.gameName;
        }
      }
      
      const components = buildComponents(snapshot.items, updatedAt, rankEmojis, nameMap, data.entries);
      
      // Supprimer l'ancien leaderboard épinglé s'il existe
      const oldPin = loadPinData();
      if (oldPin) {
        try {
          const oldChannel = await interaction.client.channels.fetch(oldPin.channelId);
          if (oldChannel) {
            const oldMsg = await oldChannel.messages.fetch(oldPin.messageId).catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => {});
          }
        } catch {}
      }
      
      await interaction.deleteReply().catch(() => {});
      const pinnedMsg = await interaction.channel.send({ components, flags: MessageFlags.IsComponentsV2 });
      
      savePinData({
        channelId: interaction.channel.id,
        messageId: pinnedMsg.id,
        guildId: interaction.guild.id,
      });
    } catch (error) {
      console.error("Error:", error);
      if (error.status === 401 || error.status === 403) {
        await interaction.editReply(
          "❌ Clé Riot invalide ou expirée. Vérifie `RIOT_API_KEY` dans `.env`."
        );
        return;
      }
      await interaction.editReply("❌ Erreur lors de la création du leaderboard.");
    }
  },
};
