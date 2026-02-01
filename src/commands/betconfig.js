const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const betting = require("../betting");

const BETTING_CONFIG_PATH = path.join(__dirname, "..", "data", "betting-config.json");

function loadBettingConfig() {
  try {
    const raw = fs.readFileSync(BETTING_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { 
      enabled: true, 
      channelId: null, 
      roleId: null,
      pollIntervalMs: 60000
    };
  }
}

function saveBettingConfig(config) {
  fs.mkdirSync(path.dirname(BETTING_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(BETTING_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("betconfig")
    .setDescription("Configuration du système de paris (Admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName("channel")
        .setDescription("Définir le channel pour les annonces de paris")
        .addChannelOption(opt =>
          opt.setName("channel")
            .setDescription("Le channel où seront postés les paris")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("role")
        .setDescription("Définir le rôle @parieur à mentionner")
        .addRoleOption(opt =>
          opt.setName("role")
            .setDescription("Le rôle à mentionner (ex: @parieur)")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("toggle")
        .setDescription("Activer/désactiver le système de paris")
        .addBooleanOption(opt =>
          opt.setName("enabled")
            .setDescription("Activer ou désactiver")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("Voir la configuration actuelle")
    )
    .addSubcommand(sub =>
      sub.setName("resolve")
        .setDescription("Résoudre manuellement un pari (si auto-résolution échoue)")
        .addStringOption(opt =>
          opt.setName("gameid")
            .setDescription("L'ID de la game")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("winner")
            .setDescription("L'équipe gagnante")
            .setRequired(true)
            .addChoices(
              { name: "🔵 Équipe Bleue", value: "blue" },
              { name: "🔴 Équipe Rouge", value: "red" }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("cancel")
        .setDescription("Annuler un ou plusieurs paris et rembourser les parieurs")
        .addStringOption(opt =>
          opt.setName("gameids")
            .setDescription("ID(s) de game séparés par des virgules (ex: 123,456,789) ou 'all' pour tout annuler")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("give")
        .setDescription("Donner des jetons à un utilisateur")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("L'utilisateur")
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("amount")
            .setDescription("Montant de jetons")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100000)
        )
    )
    .addSubcommand(sub =>
      sub.setName("reset")
        .setDescription("Réinitialiser les jetons d'un utilisateur à 1000")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("L'utilisateur")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("resetall")
        .setDescription("⚠️ Annuler TOUS les paris actifs et rembourser tout le monde")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "channel":
        await handleSetChannel(interaction);
        break;
      case "role":
        await handleSetRole(interaction);
        break;
      case "toggle":
        await handleToggle(interaction);
        break;
      case "status":
        await handleStatus(interaction);
        break;
      case "resolve":
        await handleResolve(interaction);
        break;
      case "cancel":
        await handleCancel(interaction);
        break;
      case "give":
        await handleGive(interaction);
        break;
      case "reset":
        await handleReset(interaction);
        break;
      case "resetall":
        await handleResetAll(interaction);
        break;
    }
  }
};

async function handleSetChannel(interaction) {
  const channel = interaction.options.getChannel("channel");
  
  const config = loadBettingConfig();
  config.channelId = channel.id;
  saveBettingConfig(config);

  await interaction.reply({
    content: `✅ Channel de paris configuré: ${channel}`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleSetRole(interaction) {
  const role = interaction.options.getRole("role");
  
  const config = loadBettingConfig();
  config.roleId = role.id;
  saveBettingConfig(config);

  await interaction.reply({
    content: `✅ Rôle parieur configuré: ${role}\n\nCe rôle sera mentionné quand un membre sera en SoloQ.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleToggle(interaction) {
  const enabled = interaction.options.getBoolean("enabled");
  
  const config = loadBettingConfig();
  config.enabled = enabled;
  saveBettingConfig(config);

  await interaction.reply({
    content: enabled 
      ? "✅ Système de paris **activé**" 
      : "❌ Système de paris **désactivé**",
    flags: MessageFlags.Ephemeral
  });
}

async function handleStatus(interaction) {
  const config = loadBettingConfig();
  const activeBets = betting.getAllActiveBets();
  const betCount = Object.keys(activeBets).length;

  const channelText = config.channelId ? `<#${config.channelId}>` : "Non configuré ⚠️";
  const roleText = config.roleId ? `<@&${config.roleId}>` : "Non configuré";

  await interaction.reply({
    content: 
      `**📊 Configuration du système de paris**\n\n` +
      `• Status: ${config.enabled ? "✅ Activé" : "❌ Désactivé"}\n` +
      `• Channel: ${channelText}\n` +
      `• Rôle parieur: ${roleText}\n` +
      `• Intervalle de vérification: ${config.pollIntervalMs / 1000}s\n` +
      `• Paris actifs: ${betCount}\n\n` +
      `*Utilisez les sous-commandes pour modifier la configuration.*`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleResolve(interaction) {
  const gameId = interaction.options.getString("gameid");
  const winner = interaction.options.getString("winner");

  const result = betting.resolveBet(gameId, winner);

  if (!result.success) {
    await interaction.reply({
      content: `❌ ${result.error}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const winnerEmoji = winner === "blue" ? "🔵" : "🔴";
  
  await interaction.reply({
    content: 
      `✅ Pari résolu !\n\n` +
      `${winnerEmoji} Équipe **${winner === "blue" ? "Bleue" : "Rouge"}** gagnante\n` +
      `👥 Gagnants: ${result.results.winners.length}\n` +
      `💸 Perdants: ${result.results.losers.length}\n` +
      `💰 Total distribué: ${result.results.totalDistributed.toLocaleString()} jetons`
  });

  // Mettre à jour le message du pari s'il existe
  if (result.bet.messageId && result.bet.channelId) {
    try {
      const channel = await interaction.client.channels.fetch(result.bet.channelId);
      const msg = await channel.messages.fetch(result.bet.messageId);
      
      if (msg && msg.editable) {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require("discord.js");
        
        const embed = EmbedBuilder.from(msg.embeds[0])
          .setTitle(`${winnerEmoji} VICTOIRE ${winner === "blue" ? "BLEUE" : "ROUGE"} !`)
          .setColor(winner === "blue" ? 0x0099FF : 0xFF4444);

        const disabledRow = new ActionRowBuilder()
          .addComponents(
            msg.components[0].components.map(btn => 
              ButtonBuilder.from(btn).setDisabled(true)
            )
          );

        await msg.edit({ embeds: [embed], components: [disabledRow] });
      }
    } catch (err) {
      console.error("[Betting] Erreur update message résolu:", err.message);
    }
  }
}

async function handleCancel(interaction) {
  const gameIdsInput = interaction.options.getString("gameids");
  
  let gameIds = [];
  
  if (gameIdsInput.toLowerCase() === "all") {
    // Annuler tous les paris actifs
    const activeBets = betting.getAllActiveBets();
    gameIds = Object.keys(activeBets);
    
    if (gameIds.length === 0) {
      await interaction.reply({
        content: "❌ Aucun pari actif à annuler.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  } else {
    // Séparer par virgules et nettoyer
    gameIds = gameIdsInput.split(",").map(id => id.trim()).filter(id => id);
  }
  
  const results = [];
  let totalRefunded = 0;
  
  for (const gameId of gameIds) {
    const result = betting.cancelBet(gameId);
    if (result.success) {
      results.push(`✅ Game ${gameId}: ${result.refunded} remboursé(s)`);
      totalRefunded += result.refunded;
    } else {
      results.push(`❌ Game ${gameId}: ${result.error}`);
    }
  }
  
  await interaction.reply({
    content: `**Résultat de l'annulation:**\n${results.join("\n")}\n\n💰 **Total:** ${totalRefunded} parieur(s) remboursé(s)`
  });
}

async function handleGive(interaction) {
  const user = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");

  betting.updateWallet(user.id, amount);
  const wallet = betting.getWallet(user.id);

  await interaction.reply({
    content: `✅ **${amount}** jetons donnés à ${user}\n💰 Nouveau solde: **${wallet.balance}** jetons`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleReset(interaction) {
  const user = interaction.options.getUser("user");

  const wallets = betting.loadWallets();
  wallets.wallets[user.id] = {
    balance: wallets.defaultTokens || 1000,
    totalWon: 0,
    totalLost: 0,
    betsWon: 0,
    betsLost: 0,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(
    path.join(__dirname, "..", "data", "wallets.json"), 
    JSON.stringify(wallets, null, 2)
  );

  await interaction.reply({
    content: `✅ Jetons de ${user} réinitialisés à **1000**`,
    flags: MessageFlags.Ephemeral
  });
}
async function handleResetAll(interaction) {
  const activeBetsPath = path.join(__dirname, "..", "data", "active-bets.json");
  
  // Charger les paris actifs
  let data;
  try {
    data = JSON.parse(fs.readFileSync(activeBetsPath, "utf8"));
  } catch {
    data = { activeBets: {}, betHistory: [] };
  }
  
  const activeGameIds = Object.keys(data.activeBets || {});
  
  if (activeGameIds.length === 0) {
    await interaction.reply({
      content: "ℹ️ Aucun pari actif à annuler.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  
  // Annuler chaque pari et rembourser
  let totalBets = 0;
  let totalRefunded = 0;
  
  for (const gameId of activeGameIds) {
    const result = betting.cancelBet(gameId);
    if (result.success) {
      totalBets++;
      totalRefunded += result.refunded;
    }
  }
  
  // Forcer le reset du fichier
  data.activeBets = {};
  fs.writeFileSync(activeBetsPath, JSON.stringify(data, null, 2));
  
  await interaction.reply({
    content: `✅ **Reset complet effectué !**\n\n🎲 **${totalBets}** pari(s) annulé(s)\n💰 **${totalRefunded}** parieur(s) remboursé(s)\n\n*Le fichier active-bets.json a été vidé.*`
  });
}