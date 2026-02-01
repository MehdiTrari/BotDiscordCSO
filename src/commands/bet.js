const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const {
  getWallet,
  getLeaderboardWallets,
  getBettorsLeaderboard,
  getAllActiveBets,
  calculateOdds,
  loadBets
} = require("../betting");

const RANK_EMOJI_PATH = path.join(__dirname, "..", "data", "rank-emojis.json");

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bet")
    .setDescription("Système de paris sur les matchs de SoloQ")
    .addSubcommand(sub =>
      sub.setName("wallet")
        .setDescription("Voir votre portefeuille de jetons")
    )
    .addSubcommand(sub =>
      sub.setName("leaderboard")
        .setDescription("Voir le classement par jetons")
    )
    .addSubcommand(sub =>
      sub.setName("winrate")
        .setDescription("Voir le classement par winrate")
    )
    .addSubcommand(sub =>
      sub.setName("active")
        .setDescription("Voir les paris en cours (détaillé)")
    )
    .addSubcommand(sub =>
      sub.setName("live")
        .setDescription("Voir les paris en cours (minimaliste)")
    )
    .addSubcommand(sub =>
      sub.setName("history")
        .setDescription("Voir l'historique de vos paris")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "wallet":
        await handleWallet(interaction);
        break;
      case "leaderboard":
        await handleLeaderboard(interaction);
        break;
      case "winrate":
        await handleWinrate(interaction);
        break;
      case "active":
        await handleActive(interaction);
        break;
      case "live":
        await handleLive(interaction);
        break;
      case "history":
        await handleHistory(interaction);
        break;
    }
  }
};

async function handleWallet(interaction) {
  const wallet = getWallet(interaction.user.id);
  
  const winRate = wallet.betsWon + wallet.betsLost > 0
    ? Math.round((wallet.betsWon / (wallet.betsWon + wallet.betsLost)) * 100)
    : 0;
  
  const embed = new EmbedBuilder()
    .setTitle("💰 Votre Portefeuille")
    .setColor(0xFFD700)
    .addFields(
      { name: "Solde", value: `**${wallet.balance.toLocaleString()}** jetons`, inline: true },
      { name: "Total gagné", value: `+${wallet.totalWon.toLocaleString()}`, inline: true },
      { name: "Total perdu", value: `-${wallet.totalLost.toLocaleString()}`, inline: true },
      { name: "Paris gagnés", value: `${wallet.betsWon}`, inline: true },
      { name: "Paris perdus", value: `${wallet.betsLost}`, inline: true },
      { name: "Winrate", value: `${winRate}%`, inline: true }
    )
    .setFooter({ text: "Chaque membre commence avec 1000 jetons" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleLeaderboard(interaction) {
  const topWallets = getLeaderboardWallets(15);
  
  if (topWallets.length === 0) {
    await interaction.reply({ 
      content: "Aucun parieur enregistré pour le moment.", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const lines = [];
  for (let i = 0; i < topWallets.length; i++) {
    const wallet = topWallets[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const winRate = wallet.betsWon + wallet.betsLost > 0
      ? Math.round((wallet.betsWon / (wallet.betsWon + wallet.betsLost)) * 100)
      : 0;
    
    try {
      const member = await interaction.guild.members.fetch(wallet.userId);
      lines.push(`${medal} **${member.displayName}** - ${wallet.balance.toLocaleString()} jetons (${winRate}% WR)`);
    } catch {
      lines.push(`${medal} <@${wallet.userId}> - ${wallet.balance.toLocaleString()} jetons (${winRate}% WR)`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("💰 Classement par Jetons")
    .setColor(0xFFD700)
    .setDescription(lines.join("\n"))
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleWinrate(interaction) {
  const topBettors = getBettorsLeaderboard(15, 1);
  
  if (topBettors.length === 0) {
    await interaction.reply({ 
      content: "Aucun parieur avec des paris terminés pour le moment.", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const lines = [];
  for (let i = 0; i < topBettors.length; i++) {
    const bettor = topBettors[i];
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const profitStr = bettor.profit >= 0 ? `+${bettor.profit.toLocaleString()}` : `${bettor.profit.toLocaleString()}`;
    const profitColor = bettor.profit >= 0 ? "✅" : "❌";
    
    try {
      const member = await interaction.guild.members.fetch(bettor.userId);
      lines.push(`${medal} **${member.displayName}** - **${bettor.winrate.toFixed(0)}%** (${bettor.betsWon}W/${bettor.betsLost}L) ${profitColor} ${profitStr}`);
    } catch {
      lines.push(`${medal} <@${bettor.userId}> - **${bettor.winrate.toFixed(0)}%** (${bettor.betsWon}W/${bettor.betsLost}L) ${profitColor} ${profitStr}`);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("📊 Classement par Winrate")
    .setColor(0x00FF00)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Minimum 1 pari terminé pour apparaître" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleActive(interaction) {
  const activeBets = getAllActiveBets();
  const betIds = Object.keys(activeBets);
  
  if (betIds.length === 0) {
    await interaction.reply({ 
      content: "🎲 Aucun pari actif pour le moment.\n\nLes paris s'ouvrent automatiquement quand un membre du leaderboard lance une SoloQ !", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const embeds = [];
  
  for (const gameId of betIds) {
    const bet = activeBets[gameId];
    const odds = calculateOdds(bet.pools.blue, bet.pools.red);
    const totalPool = bet.pools.blue + bet.pools.red;
    
    const timeLeft = Math.max(0, Math.floor((bet.bettingEndsAt - Date.now()) / 1000));
    const statusText = bet.status === "open" && timeLeft > 0
      ? `⏰ ${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s restantes`
      : "🔒 Paris fermés";

    // Récupérer les emojis de rang du serveur
    const rankEmojis = await resolveRankEmojisForGuild(interaction.guild);

    // Format: RankEmoji Champion • Rang LP • WR% (W/L)
    const formatTeamList = (participants) => participants.map(p => {
      // StreamerMode: pas de puuid = mode streamer
      const isStreamerMode = !p.puuid;
      // Iron pour streamermode OU unranked
      const rankEmoji = isStreamerMode ? (rankEmojis["IRON"] || "⬜") : (p.rankInfo ? (rankEmojis[p.rankInfo.tier] || "⬜") : (rankEmojis["IRON"] || "⬜"));
      const name = isStreamerMode ? "StreamerMode" : (p.playerName || "?");
      
      // Simplifier rang pour Master+
      let rankText = "Unranked";
      if (!isStreamerMode && p.rankInfo) {
        const tier = p.rankInfo.tier;
        if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
          rankText = `${tier.charAt(0)}${tier.slice(1).toLowerCase()} ${p.rankInfo.lp} LP`;
        } else {
          rankText = `${tier.charAt(0)}${tier.slice(1).toLowerCase()} ${p.rankInfo.rank} ${p.rankInfo.lp} LP`;
        }
      }
      
      const wrText = !isStreamerMode && p.rankInfo && p.rankInfo.winrate !== undefined ? `${p.rankInfo.winrate}% (${p.rankInfo.wins}W/${p.rankInfo.losses}L)` : "";
      return `${rankEmoji} **${p.championName}** • ${rankText}${wrText ? ` • ${wrText}` : ""}\n└ ${name}`;
    }).join("\n");

    const blueTeamList = formatTeamList(bet.blueTeam.participants);
    const redTeamList = formatTeamList(bet.redTeam.participants);

    // Construire la liste des parieurs
    const blueBettors = bet.bets.blue.length > 0
      ? bet.bets.blue.map(b => `<@${b.userId}> (${b.amount})`).join(", ")
      : "—";
    const redBettors = bet.bets.red.length > 0
      ? bet.bets.red.map(b => `<@${b.userId}> (${b.amount})`).join(", ")
      : "—";

    const embed = new EmbedBuilder()
      .setTitle(`🎮 ${bet.trackedPlayer.gameName} est en game !`)
      .setColor(bet.trackedPlayer.teamId === 100 ? 0x0099FF : 0xFF4444)
      .setDescription(`**${bet.trackedPlayer.championName}** - Équipe ${bet.trackedPlayer.teamId === 100 ? "Bleue 🔵" : "Rouge 🔴"}`)
      .setThumbnail(bet.trackedPlayer.championIcon)
      .addFields(
        { name: "🔵 Équipe Bleue", value: blueTeamList || "N/A", inline: false },
        { name: "🔴 Équipe Rouge", value: redTeamList || "N/A", inline: false },
        { name: "📊 Cotes", value: `🔵 x${odds.blue.toFixed(2)} | 🔴 x${odds.red.toFixed(2)}`, inline: true },
        { name: "💰 Pool total", value: `${totalPool.toLocaleString()} jetons`, inline: true },
        { name: "📈 Mises", value: `🔵 ${bet.pools.blue.toLocaleString()} | 🔴 ${bet.pools.red.toLocaleString()}`, inline: true },
        { name: `🔵 Parieurs Bleu (${bet.bets.blue.length})`, value: blueBettors.slice(0, 200), inline: true },
        { name: `🔴 Parieurs Rouge (${bet.bets.red.length})`, value: redBettors.slice(0, 200), inline: true },
        { name: "Status", value: statusText, inline: false }
      )
      .setFooter({ text: `Game ID: ${gameId} • /betconfig resolve ${gameId} blue|red` })
      .setTimestamp();

    embeds.push(embed);
  }

  await interaction.reply({ embeds: embeds.slice(0, 10) });
}

async function handleHistory(interaction) {
  const data = loadBets();
  const userId = interaction.user.id;
  
  // Filtrer l'historique pour l'utilisateur
  const userHistory = data.betHistory
    .filter(bet => {
      const inBlue = bet.bets.blue.some(b => b.userId === userId);
      const inRed = bet.bets.red.some(b => b.userId === userId);
      return inBlue || inRed;
    })
    .slice(-10)
    .reverse();

  if (userHistory.length === 0) {
    await interaction.reply({ 
      content: "📜 Vous n'avez pas encore d'historique de paris.", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const lines = [];
  
  for (const bet of userHistory) {
    const userBetBlue = bet.bets.blue.find(b => b.userId === userId);
    const userBetRed = bet.bets.red.find(b => b.userId === userId);
    const userBet = userBetBlue || userBetRed;
    const team = userBetBlue ? "blue" : "red";
    
    const won = bet.winningTeam === team;
    const emoji = bet.status === "cancelled" ? "↩️" : won ? "✅" : "❌";
    const result = bet.status === "cancelled" 
      ? "Annulé (remboursé)"
      : won 
        ? `+${Math.floor(userBet.amount * userBet.oddsAtBet).toLocaleString()}`
        : `-${userBet.amount.toLocaleString()}`;
    
    const date = new Date(bet.resolvedAt || bet.cancelledAt).toLocaleDateString("fr-FR");
    const teamEmoji = team === "blue" ? "🔵" : "🔴";
    
    lines.push(`${emoji} ${teamEmoji} **${bet.trackedPlayer.gameName}** - ${userBet.amount} jetons → ${result} *(${date})*`);
  }

  const embed = new EmbedBuilder()
    .setTitle("📜 Historique de vos paris")
    .setColor(0x5865F2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "10 derniers paris affichés" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleLive(interaction) {
  const activeBets = getAllActiveBets();
  const betIds = Object.keys(activeBets);
  
  if (betIds.length === 0) {
    await interaction.reply({ 
      content: "🎲 Aucun pari en cours.", 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const lines = [];
  
  for (const gameId of betIds) {
    const bet = activeBets[gameId];
    const odds = calculateOdds(bet.pools.blue, bet.pools.red);
    const totalPool = bet.pools.blue + bet.pools.red;
    
    const timeLeft = Math.max(0, Math.floor((bet.bettingEndsAt - Date.now()) / 1000));
    const statusIcon = bet.status === "open" && timeLeft > 0 ? "🟢" : "🔴";
    
    const teamSide = bet.trackedPlayer.teamId === 100 ? "🔵" : "🔴";
    
    // Liste des parieurs compacte
    const blueBettors = bet.bets.blue.map(b => `<@${b.userId}>`).join(" ");
    const redBettors = bet.bets.red.map(b => `<@${b.userId}>`).join(" ");
    
    lines.push(
      `${statusIcon} **${bet.trackedPlayer.gameName}** (${bet.trackedPlayer.championName}) ${teamSide}`,
      `┗ 🔵 x${odds.blue.toFixed(2)} (${bet.pools.blue}) vs x${odds.red.toFixed(2)} (${bet.pools.red}) 🔴 | Pool: ${totalPool}`,
      `┗ 🔵 ${blueBettors || "—"} | ${redBettors || "—"} 🔴`,
      ``
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("🎲 Paris en cours")
    .setColor(0xFFD700)
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: `${betIds.length} pari(s) actif(s)` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
