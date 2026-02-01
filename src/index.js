const { Client, Collection, GatewayIntentBits, Events, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const { token } = require("./config");
const { refreshLeaderboard, loadPinData, loadData, saveData, parseRiotId, resolvePuuid } = require("./leaderboard");

// Import du système de logs (fichier séparé pour éviter dépendance circulaire)
const { addLog, loadLogsPinData, buildLogsComponents } = require("./logs-utils");

// Import du système de paris
const betting = require("./betting");

// Configuration du système de paris
const BETTING_CONFIG_PATH = path.join(__dirname, "data", "betting-config.json");

function loadBettingConfig() {
  try {
    const raw = fs.readFileSync(BETTING_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { 
      enabled: true, 
      channelId: null, 
      roleId: null, // @parieur role ID
      pollIntervalMs: 60000 // 1 minute
    };
  }
}

function saveBettingConfig(config) {
  fs.mkdirSync(path.dirname(BETTING_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(BETTING_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

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

  // =====================
  // SYSTÈME DE PARIS - POLLING DES GAMES LIVE
  // =====================
  const activeGames = new Map(); // puuid -> gameId
  
  // Charger les noms de champions au démarrage
  betting.loadChampionNames();

  /**
   * Envoie le message de résultat d'un pari dans le channel
   */
  async function sendBetResultMessage(bet, gameResult, resolution) {
    const bettingConfig = loadBettingConfig();
    if (!bettingConfig.channelId) return;

    try {
      const channel = await readyClient.channels.fetch(bettingConfig.channelId);
      if (!channel) return;

      const winEmoji = gameResult.winner === "blue" ? "🔵" : "🔴";
      const loseEmoji = gameResult.winner === "blue" ? "🔴" : "🔵";
      const teamName = gameResult.winner === "blue" ? "Bleue" : "Rouge";
      
      // Formater la durée de la game
      const minutes = Math.floor(gameResult.gameDuration / 60);
      const seconds = gameResult.gameDuration % 60;
      const durationStr = `${minutes}m${seconds.toString().padStart(2, '0')}s`;

      // Construire la liste des gagnants
      const winnersList = resolution.results.winners.length > 0 
        ? resolution.results.winners.map(w => 
            `<@${w.userId}> → **+${w.winnings.toLocaleString()}** jetons (mise: ${w.amount}, cote: x${w.oddsAtBet.toFixed(2)})`
          ).join("\n")
        : "Aucun parieur";

      // Construire la liste des perdants  
      const losersList = resolution.results.losers.length > 0
        ? resolution.results.losers.map(l =>
            `<@${l.userId}> (-${l.amount} jetons)`
          ).join(", ")
        : "Aucun";

      const embed = new EmbedBuilder()
        .setTitle(`🏆 PARIS TERMINÉS - ${bet.trackedPlayer.gameName}`)
        .setDescription(
          `${winEmoji} **L'équipe ${teamName} remporte la victoire !**\n\n` +
          `🎮 **${bet.trackedPlayer.championName}** a ${bet.trackedPlayer.teamId === (gameResult.winner === "blue" ? 100 : 200) ? "**GAGNÉ** ✅" : "**PERDU** ❌"}\n` +
          `⏱️ Durée: **${durationStr}**`
        )
        .setColor(gameResult.winner === "blue" ? 0x0099FF : 0xFF4444)
        .setThumbnail(bet.trackedPlayer.championIcon)
        .addFields(
          { name: `${winEmoji} Gagnants`, value: winnersList.slice(0, 1024) || "Aucun", inline: false },
          { name: `${loseEmoji} Perdants`, value: losersList.slice(0, 1024) || "Aucun", inline: false },
          { name: "💰 Pool total", value: `${(bet.pools.blue + bet.pools.red).toLocaleString()} jetons distribués`, inline: true }
        )
        .setTimestamp();

      // Mettre à jour l'ancien message de pari si possible
      if (bet.messageId) {
        try {
          const oldMsg = await channel.messages.fetch(bet.messageId);
          if (oldMsg) {
            await oldMsg.edit({ 
              content: `~~${oldMsg.content || ""}~~`,
              embeds: [embed],
              components: [] // Enlever les boutons
            });
          }
        } catch {
          // Si on ne peut pas modifier l'ancien message, en envoyer un nouveau
          await channel.send({ embeds: [embed] });
        }
      } else {
        await channel.send({ embeds: [embed] });
      }

      console.log(`[Betting] 📢 Message de résultat envoyé`);
    } catch (error) {
      console.error(`[Betting] Erreur envoi message résultat:`, error);
    }
  }

  const checkLiveGames = async () => {
    const bettingConfig = loadBettingConfig();
    if (!bettingConfig.enabled || !bettingConfig.channelId) return;

    const trackedPlayers = betting.loadTrackedPlayers();
    if (trackedPlayers.length === 0) return;

    for (const player of trackedPlayers) {
      if (!player.puuid) continue;

      try {
        // Attendre un peu entre chaque requête pour éviter le rate limit
        await new Promise(r => setTimeout(r, 1500));
        
        const gameInfo = await betting.checkLiveGame(player.puuid);
        
        if (!gameInfo) {
          // Le joueur n'est plus en game, vérifier si on doit résoudre un pari
          const gameId = activeGames.get(player.puuid);
          const existingBet = betting.getActiveBet(gameId);
          
          if (existingBet && existingBet.trackedPlayer.puuid === player.puuid && existingBet.status !== "resolved") {
            console.log(`[Betting] 🏁 ${player.gameName} n'est plus en game, vérification du résultat...`);
            
            // Attendre un peu car la game peut mettre quelques secondes à apparaître dans l'historique
            await new Promise(r => setTimeout(r, 3000));
            
            // Récupérer le résultat via Match-V5
            const result = await betting.checkGameResult(existingBet);
            
            if (result && result.finished) {
              console.log(`[Betting] ✅ Game terminée ! Équipe ${result.winner} gagne`);
              
              // Résoudre le pari
              const resolution = betting.resolveBet(gameId, result.winner);
              
              if (resolution.success) {
                // Envoyer le message de résultat dans le channel
                await sendBetResultMessage(existingBet, result, resolution);
              }
            } else {
              console.log(`[Betting] ⏳ Résultat pas encore disponible, on réessaiera...`);
              // On garde le gameId pour réessayer au prochain cycle
              continue;
            }
          }
          
          activeGames.delete(player.puuid);
          continue;
        }

        // Vérifier si c'est une SoloQ
        if (!betting.isSoloQGame(gameInfo)) continue;

        const gameId = String(gameInfo.gameId);
        
        // Vérifier si on a déjà créé un pari pour cette game
        if (betting.getActiveBet(gameId)) continue;

        // Nouvelle game détectée !
        const playerInGame = betting.getTrackedPlayerInGame(gameInfo, player.puuid);
        if (!playerInGame) continue;

        activeGames.set(player.puuid, gameId);

        console.log(`[Betting] 🎮 ${player.gameName} est en SoloQ ! Champion: ${betting.getChampionName(playerInGame.championId)}`);

        // Récupérer les pseudos de tous les joueurs de la game
        console.log(`[Betting] Récupération des pseudos des joueurs...`);
        const participantsNames = await betting.getParticipantsNames(gameInfo.participants);

        // Récupérer les rangs de tous les joueurs de la game
        console.log(`[Betting] Récupération des rangs des joueurs...`);
        const participantsRanks = await betting.getParticipantsRanks(gameInfo.participants);

        // Créer le pari avec les pseudos et rangs
        const bet = betting.createBet(gameInfo, player, playerInGame, participantsNames, participantsRanks);

        // Récupérer le pseudo Discord du joueur tracké
        let discordDisplayName = player.gameName;
        try {
          const guild = await readyClient.guilds.fetch(bettingConfig.guildId || readyClient.guilds.cache.first()?.id);
          if (guild) {
            const member = await guild.members.fetch(player.discordId);
            discordDisplayName = member.displayName;
          }
        } catch { /* Utiliser le gameName par défaut */ }

        // Envoyer le message dans le channel de paris
        try {
          const channel = await readyClient.channels.fetch(bettingConfig.channelId);
          if (channel) {
            const odds = betting.calculateOdds(0, 0);
            
            // Récupérer les emojis de rang du serveur
            const guild = channel.guild;
            const rankEmojis = await resolveRankEmojisForGuild(guild);
            
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
            
            const embed = new EmbedBuilder()
              .setTitle(`🎲 PARIS OUVERTS !`)
              .setDescription(
                `**${discordDisplayName}** (${player.gameName}#${player.tagLine}) est en SoloQ !\n` +
                `Joue **${bet.trackedPlayer.championName}** côté ${playerInGame.teamId === 100 ? "🔵 Bleu" : "🔴 Rouge"}`
              )
              .setColor(0xFFD700)
              .setThumbnail(bet.trackedPlayer.championIcon)
              .addFields(
                { name: "🔵 Équipe Bleue", value: blueTeamList || "N/A", inline: false },
                { name: "🔴 Équipe Rouge", value: redTeamList || "N/A", inline: false },
                { name: "📊 Cotes", value: `🔵 **x${odds.blue.toFixed(2)}** | 🔴 **x${odds.red.toFixed(2)}**`, inline: true },
                { name: "💰 Pool", value: "0 jetons", inline: true },
                { name: "⏰ Temps", value: `<t:${Math.floor(bet.bettingEndsAt / 1000)}:R>`, inline: true }
              )
              .setFooter({ text: `Game ID: ${gameId} • Les paris se ferment automatiquement` })
              .setTimestamp();

            const row = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(`bet_blue_100_${gameId}`)
                  .setLabel("🔵 100")
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`bet_blue_500_${gameId}`)
                  .setLabel("🔵 500")
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`bet_red_100_${gameId}`)
                  .setLabel("🔴 100")
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId(`bet_red_500_${gameId}`)
                  .setLabel("🔴 500")
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId(`bet_custom_${gameId}`)
                  .setLabel("💰 Montant perso")
                  .setStyle(ButtonStyle.Secondary)
              );

            // Mention du rôle parieur désactivée pour éviter le spam
            // const roleMention = bettingConfig.roleId ? `<@&${bettingConfig.roleId}>` : "";
            
            const msg = await channel.send({ 
              // content: roleMention ? `${roleMention} Un membre est en SoloQ !` : undefined,
              embeds: [embed], 
              components: [row] 
            });

            // Sauvegarder le message ID pour les mises à jour
            const betsData = betting.loadBets();
            if (betsData.activeBets[gameId]) {
              betsData.activeBets[gameId].messageId = msg.id;
              betsData.activeBets[gameId].channelId = channel.id;
              fs.writeFileSync(path.join(__dirname, "data", "active-bets.json"), JSON.stringify(betsData, null, 2));
            }

            // Programmer la fermeture automatique des paris
            setTimeout(async () => {
              betting.closeBetting(gameId);
              try {
                const updatedBet = betting.getActiveBet(gameId);
                if (updatedBet && msg.editable) {
                  const newOdds = betting.calculateOdds(updatedBet.pools.blue, updatedBet.pools.red);
                  const totalPool = updatedBet.pools.blue + updatedBet.pools.red;
                  
                  const closedEmbed = EmbedBuilder.from(msg.embeds[0])
                    .setTitle("🔒 PARIS FERMÉS")
                    .setColor(0x888888)
                    .spliceFields(3, 3,
                      { name: "📊 Cotes finales", value: `🔵 **x${newOdds.blue.toFixed(2)}** | 🔴 **x${newOdds.red.toFixed(2)}**`, inline: true },
                      { name: "💰 Pool total", value: `${totalPool.toLocaleString()} jetons`, inline: true },
                      { name: "⏰ Status", value: "Paris fermés - En attente du résultat", inline: true }
                    );

                  // Désactiver les boutons
                  const disabledRow = new ActionRowBuilder()
                    .addComponents(
                      row.components.map(btn => ButtonBuilder.from(btn).setDisabled(true))
                    );

                  await msg.edit({ embeds: [closedEmbed], components: [disabledRow] });
                }
              } catch (err) {
                console.error("[Betting] Erreur fermeture paris:", err.message);
              }
            }, betting.BETTING_WINDOW_MS);
          }
        } catch (err) {
          console.error("[Betting] Erreur envoi message:", err.message);
        }
      } catch (error) {
        if (error.status !== 404) {
          console.error(`[Betting] Erreur check ${player.gameName}:`, error.message);
        }
      }
    }
  };

  // Vérifier les games toutes les minutes
  const bettingConfig = loadBettingConfig();
  setInterval(checkLiveGames, bettingConfig.pollIntervalMs || 60000);
  // Premier check après 10 secondes
  setTimeout(checkLiveGames, 10000);

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
      await interaction.followUp({ content: "Erreur lors de l'exécution de la commande.", flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: "Erreur lors de l'exécution de la commande.", flags: MessageFlags.Ephemeral });
    }
  }
});

// Button interaction handler
async function handleButtonInteraction(interaction) {
  const { customId } = interaction;

  // =====================
  // BETTING BUTTONS
  // =====================
  if (customId.startsWith("bet_")) {
    await handleBetButton(interaction);
    return;
  }

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

  // Modal pour pari personnalisé
  if (interaction.customId.startsWith("bet_modal_")) {
    await handleBetModal(interaction);
    return;
  }
}

// =====================
// BETTING HANDLERS
// =====================

async function handleBetButton(interaction) {
  const { customId } = interaction;
  
  // Format: bet_<team>_<amount>_<gameId> ou bet_custom_<gameId>
  const parts = customId.split("_");
  
  if (parts[1] === "custom") {
    // Ouvrir le modal pour montant personnalisé
    const gameId = parts.slice(2).join("_");
    
    const modal = new ModalBuilder()
      .setCustomId(`bet_modal_${gameId}`)
      .setTitle("Parier un montant personnalisé");

    const amountInput = new TextInputBuilder()
      .setCustomId("bet_amount")
      .setLabel("Montant de jetons")
      .setPlaceholder(`Entre ${betting.MIN_BET} et ${betting.MAX_BET}`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(6);

    const teamInput = new TextInputBuilder()
      .setCustomId("bet_team")
      .setLabel("Équipe (bleu ou rouge)")
      .setPlaceholder("bleu ou rouge")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(5);

    modal.addComponents(
      new ActionRowBuilder().addComponents(amountInput),
      new ActionRowBuilder().addComponents(teamInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // Pari avec montant prédéfini
  const team = parts[1]; // blue ou red
  const amount = parseInt(parts[2]);
  const gameId = parts.slice(3).join("_");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = betting.placeBet(gameId, interaction.user.id, team, amount);

  if (!result.success) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }

  const teamEmoji = team === "blue" ? "🔵" : "🔴";
  const wallet = betting.getWallet(interaction.user.id);

  await interaction.editReply(
    `✅ Pari placé !\n` +
    `${teamEmoji} **${amount}** jetons sur l'équipe ${team === "blue" ? "Bleue" : "Rouge"}\n` +
    `📊 Cote: **x${result.bet.oddsAtBet.toFixed(2)}**\n` +
    `💰 Gain potentiel: **${Math.floor(amount * result.bet.oddsAtBet)}** jetons\n` +
    `💳 Solde restant: **${wallet.balance}** jetons`
  );

  // Mettre à jour le message du pari
  await updateBetMessage(interaction, gameId);
}

async function handleBetModal(interaction) {
  const gameId = interaction.customId.replace("bet_modal_", "");
  
  const amountStr = interaction.fields.getTextInputValue("bet_amount");
  const teamStr = interaction.fields.getTextInputValue("bet_team").toLowerCase().trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Valider le montant
  const amount = parseInt(amountStr);
  if (isNaN(amount) || amount < betting.MIN_BET || amount > betting.MAX_BET) {
    await interaction.editReply(`❌ Montant invalide. Entrez un nombre entre ${betting.MIN_BET} et ${betting.MAX_BET}.`);
    return;
  }

  // Valider l'équipe
  let team;
  if (teamStr === "bleu" || teamStr === "blue") {
    team = "blue";
  } else if (teamStr === "rouge" || teamStr === "red") {
    team = "red";
  } else {
    await interaction.editReply("❌ Équipe invalide. Entrez 'bleu' ou 'rouge'.");
    return;
  }

  const result = betting.placeBet(gameId, interaction.user.id, team, amount);

  if (!result.success) {
    await interaction.editReply(`❌ ${result.error}`);
    return;
  }

  const teamEmoji = team === "blue" ? "🔵" : "🔴";
  const wallet = betting.getWallet(interaction.user.id);

  await interaction.editReply(
    `✅ Pari placé !\n` +
    `${teamEmoji} **${amount}** jetons sur l'équipe ${team === "blue" ? "Bleue" : "Rouge"}\n` +
    `📊 Cote: **x${result.bet.oddsAtBet.toFixed(2)}**\n` +
    `💰 Gain potentiel: **${Math.floor(amount * result.bet.oddsAtBet)}** jetons\n` +
    `💳 Solde restant: **${wallet.balance}** jetons`
  );

  // Mettre à jour le message du pari
  await updateBetMessage(interaction, gameId);
}

async function updateBetMessage(interaction, gameId) {
  const bet = betting.getActiveBet(gameId);
  if (!bet || !bet.messageId || !bet.channelId) return;

  try {
    const channel = await interaction.client.channels.fetch(bet.channelId);
    const msg = await channel.messages.fetch(bet.messageId);
    
    if (!msg || !msg.editable) return;

    const odds = betting.calculateOdds(bet.pools.blue, bet.pools.red);
    const totalPool = bet.pools.blue + bet.pools.red;
    
    const timeLeft = Math.max(0, Math.floor((bet.bettingEndsAt - Date.now()) / 1000));
    const statusText = bet.status === "open" && timeLeft > 0
      ? `<t:${Math.floor(bet.bettingEndsAt / 1000)}:R>`
      : "Paris fermés";

    // Construire la liste des parieurs
    const blueBettors = bet.bets.blue.length > 0
      ? bet.bets.blue.map(b => `<@${b.userId}> (${b.amount})`).join(", ")
      : "—";
    const redBettors = bet.bets.red.length > 0
      ? bet.bets.red.map(b => `<@${b.userId}> (${b.amount})`).join(", ")
      : "—";

    const embed = EmbedBuilder.from(msg.embeds[0])
      .spliceFields(2, 6, // Remplacer les champs à partir de l'index 2
        { name: "📊 Cotes", value: `🔵 **x${odds.blue.toFixed(2)}** | 🔴 **x${odds.red.toFixed(2)}**`, inline: true },
        { name: "💰 Pool", value: `${totalPool.toLocaleString()} jetons`, inline: true },
        { name: "⏰ Temps", value: statusText, inline: true },
        { name: `🔵 Parieurs Bleu (${bet.bets.blue.length})`, value: blueBettors.slice(0, 200), inline: true },
        { name: `🔴 Parieurs Rouge (${bet.bets.red.length})`, value: redBettors.slice(0, 200), inline: true }
      );

    await msg.edit({ embeds: [embed] });
  } catch (err) {
    console.error("[Betting] Erreur update message:", err.message);
  }
}

if (!token) {
  console.error("DISCORD_TOKEN manquant dans .env");
  process.exit(1);
}

client.login(token);
