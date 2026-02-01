/**
 * Système de paris sur les matchs de SoloQ
 * - Détection des games en live via Riot Spectator API
 * - Système de cotes dynamiques style Twitch
 * - Gestion des wallets avec 1000 jetons par défaut
 */

const fs = require("node:fs");
const path = require("node:path");
const { riotApiKey } = require("./config");
const fetch = global.fetch || require("node-fetch");

const WALLETS_PATH = path.join(__dirname, "data", "wallets.json");
const BETS_PATH = path.join(__dirname, "data", "active-bets.json");
const LEADERBOARD_PATH = path.join(__dirname, "data", "leaderboard.json");

const SPECTATOR_API = "https://euw1.api.riotgames.com";
const DEFAULT_TOKENS = 1000;
const MIN_BET = 10;
const MAX_BET = 10000;
const BETTING_WINDOW_MS = 3 * 60 * 1000; // 3 minutes pour parier après détection

// Champions mapping (ID -> Nom et ID interne pour les icônes)
// Source: https://ddragon.leagueoflegends.com/cdn/{version}/data/fr_FR/champion.json
// Fallback: https://raw.communitydragon.org pour les champions récents
const CHAMPION_DATA = {}; // { id: { name, icon } }
let championsLoaded = false;
let ddragonVersion = "16.2.1"; // Version par défaut, sera mise à jour dynamiquement

async function loadChampionNames() {
  if (championsLoaded) return;
  try {
    // Récupérer la dernière version de Data Dragon
    const versionsResponse = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    const versions = await versionsResponse.json();
    ddragonVersion = versions[0]; // Première version = la plus récente
    console.log(`[Betting] Data Dragon version: ${ddragonVersion}`);

    const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/fr_FR/champion.json`);
    const data = await response.json();
    for (const champ of Object.values(data.data)) {
      CHAMPION_DATA[champ.key] = {
        name: champ.name,
        icon: champ.id // L'ID interne pour l'URL de l'icône (ex: "Aatrox", "AurelionSol")
      };
    }
    
    // Ajouter les champions récents non présents dans Data Dragon (fallback manuel)
    // Ces champions sont ajoutés manuellement car ils ne sont pas encore dans Data Dragon
    const recentChampions = {
      "804": { name: "Yunara", icon: "Yunara" },
      "803": { name: "Mel", icon: "Mel" },
      // Ajouter d'autres champions récents si nécessaire
    };
    
    for (const [id, champ] of Object.entries(recentChampions)) {
      if (!CHAMPION_DATA[id]) {
        CHAMPION_DATA[id] = champ;
        console.log(`[Betting] Champion fallback ajouté: ${champ.name} (#${id})`);
      }
    }
    
    championsLoaded = true;
    console.log(`[Betting] ${Object.keys(CHAMPION_DATA).length} champions chargés`);
  } catch (error) {
    console.error("[Betting] Erreur chargement champions:", error.message);
  }
}

function getChampionName(championId) {
  const champ = CHAMPION_DATA[String(championId)];
  return champ ? champ.name : `Champion #${championId}`;
}

function getChampionIcon(championId) {
  const champ = CHAMPION_DATA[String(championId)];
  if (champ) {
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${champ.icon}.png`;
  }
  // Fallback vers CommunityDragon pour les champions récents
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`;
}

function getChampionEmoji(championId) {
  // Format Discord pour afficher une image inline (utilise un emoji custom ou le nom)
  const champ = CHAMPION_DATA[String(championId)];
  return champ ? champ.name : `#${championId}`;
}

// =====================
// ROLE DETECTION SYSTEM
// =====================

// Summoner Spells IDs
const SUMMONER_SPELLS = {
  SMITE: 11,
  HEAL: 7,
  TELEPORT: 12,
  FLASH: 4,
  IGNITE: 14,
  EXHAUST: 3,
  BARRIER: 21,
  CLEANSE: 1,
  GHOST: 6
};

// Ordre des rôles pour le tri
const ROLE_ORDER = { TOP: 0, JUNGLE: 1, MID: 2, ADC: 3, SUPPORT: 4, UNKNOWN: 5 };

// Mapping des champions vers leurs rôles probables (probabilité en %)
// Format: { championId: { TOP: %, JUNGLE: %, MID: %, ADC: %, SUPPORT: % } }
const CHAMPION_ROLE_PROBABILITY = {
  // === TOPS principaux ===
  "266": { TOP: 95, MID: 5 }, // Aatrox
  "164": { TOP: 85, JUNGLE: 10, MID: 5 }, // Camille
  "122": { TOP: 95, MID: 5 }, // Darius
  "36": { TOP: 90, JUNGLE: 10 }, // Dr. Mundo
  "114": { TOP: 90, MID: 10 }, // Fiora
  "3": { TOP: 70, MID: 20, SUPPORT: 10 }, // Galio
  "86": { TOP: 90, MID: 10 }, // Garen
  "150": { TOP: 95, SUPPORT: 5 }, // Gnar
  "79": { TOP: 50, MID: 40, JUNGLE: 10 }, // Gragas
  "120": { TOP: 30, JUNGLE: 70 }, // Hecarim
  "420": { TOP: 95, MID: 5 }, // Illaoi
  "39": { TOP: 70, MID: 30 }, // Irelia
  "126": { TOP: 70, MID: 30 }, // Jayce
  "240": { TOP: 90, MID: 10 }, // Kled
  "85": { TOP: 60, MID: 40 }, // Kennen
  "54": { TOP: 85, JUNGLE: 10, SUPPORT: 5 }, // Malphite
  "82": { TOP: 85, JUNGLE: 15 }, // Mordekaiser
  "516": { TOP: 85, SUPPORT: 15 }, // Ornn
  "80": { TOP: 50, MID: 30, JUNGLE: 15, SUPPORT: 5 }, // Pantheon
  "58": { TOP: 90, MID: 10 }, // Renekton
  "92": { TOP: 85, MID: 15 }, // Riven
  "68": { TOP: 80, MID: 20 }, // Rumble
  "14": { TOP: 85, JUNGLE: 15 }, // Sion
  "27": { TOP: 85, MID: 10, SUPPORT: 5 }, // Singed
  "223": { TOP: 70, SUPPORT: 30 }, // Tahm Kench
  "48": { TOP: 85, JUNGLE: 15 }, // Trundle
  "23": { TOP: 90, MID: 10 }, // Tryndamere
  "6": { TOP: 95, MID: 5 }, // Urgot
  "8": { TOP: 50, MID: 50 }, // Vladimir
  "106": { TOP: 60, JUNGLE: 40 }, // Volibear
  "19": { TOP: 30, JUNGLE: 70 }, // Warwick
  "62": { TOP: 60, JUNGLE: 40 }, // Wukong
  "157": { TOP: 40, MID: 50, ADC: 10 }, // Yasuo
  "777": { TOP: 40, MID: 60 }, // Yone
  "83": { TOP: 95, JUNGLE: 5 }, // Yorick
  "875": { TOP: 90, JUNGLE: 10 }, // Sett
  "887": { TOP: 85, MID: 10, JUNGLE: 5 }, // Gwen
  "799": { TOP: 80, JUNGLE: 15, MID: 5 }, // Ambessa
  "233": { TOP: 20, JUNGLE: 80 }, // Briar
  
  // === JUNGLERS principaux ===
  "32": { JUNGLE: 95, SUPPORT: 5 }, // Amumu
  "60": { JUNGLE: 95, TOP: 5 }, // Elise
  "28": { JUNGLE: 95, MID: 5 }, // Evelynn
  "9": { JUNGLE: 85, MID: 15 }, // Fiddlesticks
  "104": { JUNGLE: 90, ADC: 10 }, // Graves
  "121": { JUNGLE: 95, MID: 5 }, // Kha'Zix
  "203": { JUNGLE: 90, ADC: 10 }, // Kindred
  "64": { JUNGLE: 95, TOP: 5 }, // Lee Sin
  "876": { JUNGLE: 95, MID: 5 }, // Lillia
  "57": { JUNGLE: 60, TOP: 30, SUPPORT: 10 }, // Maokai
  "421": { JUNGLE: 95, TOP: 5 }, // Rek'Sai
  "107": { JUNGLE: 85, TOP: 15 }, // Rengar
  "113": { JUNGLE: 95, TOP: 5 }, // Sejuani
  "102": { JUNGLE: 90, TOP: 10 }, // Shyvana
  "154": { JUNGLE: 95, TOP: 5 }, // Zac
  "427": { JUNGLE: 95, SUPPORT: 5 }, // Ivern
  "141": { JUNGLE: 95, MID: 5 }, // Kayn
  "888": { JUNGLE: 70, TOP: 25, MID: 5 }, // Renata (actually support, fix below)
  "200": { JUNGLE: 95, TOP: 5 }, // Bel'Veth
  "221": { ADC: 95, MID: 5 }, // Zeri (fix: not jungle)
  "234": { JUNGLE: 85, TOP: 10, MID: 5 }, // Viego
  "59": { JUNGLE: 90, TOP: 10 }, // Jarvan IV
  "254": { JUNGLE: 95, TOP: 5 }, // Vi
  "5": { JUNGLE: 70, TOP: 25, MID: 5 }, // Xin Zhao
  "76": { JUNGLE: 85, MID: 15 }, // Nidalee
  "56": { JUNGLE: 95, MID: 5 }, // Nocturne
  "20": { JUNGLE: 95, TOP: 5 }, // Nunu
  "2": { JUNGLE: 95, TOP: 5 }, // Olaf
  "78": { JUNGLE: 50, TOP: 40, SUPPORT: 10 }, // Poppy
  "33": { JUNGLE: 95, TOP: 5 }, // Rammus
  "98": { TOP: 80, JUNGLE: 15, SUPPORT: 5 }, // Shen
  "35": { JUNGLE: 70, SUPPORT: 30 }, // Shaco
  "72": { JUNGLE: 85, TOP: 15 }, // Skarner
  "77": { JUNGLE: 70, TOP: 30 }, // Udyr
  "245": { JUNGLE: 60, MID: 40 }, // Ekko
  "131": { JUNGLE: 60, MID: 40 }, // Diana
  "11": { JUNGLE: 95, TOP: 5 }, // Master Yi
  
  // === MIDS principaux ===
  "103": { MID: 85, SUPPORT: 10, ADC: 5 }, // Ahri
  "84": { MID: 80, TOP: 20 }, // Akali
  "166": { MID: 60, TOP: 30, ADC: 10 }, // Akshan
  "34": { MID: 85, ADC: 15 }, // Anivia
  "1": { MID: 70, SUPPORT: 30 }, // Annie
  "136": { MID: 90, ADC: 10 }, // Aurelion Sol
  "268": { MID: 95, TOP: 5 }, // Azir
  "63": { MID: 50, SUPPORT: 45, ADC: 5 }, // Brand
  "69": { MID: 80, TOP: 15, ADC: 5 }, // Cassiopeia
  "31": { MID: 60, TOP: 40 }, // Cho'Gath
  "42": { MID: 85, ADC: 15 }, // Corki
  "38": { MID: 95, TOP: 5 }, // Kassadin
  "55": { MID: 95, TOP: 5 }, // Katarina
  "10": { MID: 70, TOP: 30 }, // Kayle
  "7": { MID: 85, SUPPORT: 15 }, // LeBlanc
  "127": { MID: 90, SUPPORT: 10 }, // Lissandra
  "99": { MID: 60, SUPPORT: 40 }, // Lux
  "90": { MID: 85, ADC: 15 }, // Malzahar
  "61": { MID: 95, SUPPORT: 5 }, // Orianna
  "13": { MID: 70, TOP: 30 }, // Ryze
  "134": { MID: 90, SUPPORT: 10 }, // Syndra
  "163": { MID: 70, JUNGLE: 25, SUPPORT: 5 }, // Taliyah
  "4": { MID: 85, ADC: 15 }, // Twisted Fate
  "112": { MID: 95, TOP: 5 }, // Viktor
  "45": { MID: 80, ADC: 15, SUPPORT: 5 }, // Veigar
  "161": { MID: 60, SUPPORT: 40 }, // Vel'Koz
  "101": { MID: 70, SUPPORT: 30 }, // Xerath
  "142": { MID: 80, SUPPORT: 20 }, // Zoe
  "115": { MID: 60, ADC: 40 }, // Ziggs
  "26": { MID: 50, SUPPORT: 50 }, // Zilean
  "238": { MID: 90, TOP: 10 }, // Zed
  "91": { MID: 70, JUNGLE: 25, TOP: 5 }, // Talon
  "105": { MID: 90, TOP: 10 }, // Fizz
  "517": { MID: 70, JUNGLE: 20, TOP: 10 }, // Sylas
  "711": { MID: 85, SUPPORT: 15 }, // Vex
  "950": { MID: 90, TOP: 10 }, // Naafiri
  "902": { MID: 85, SUPPORT: 15 }, // Milio (actually support, will fix)
  "901": { MID: 95, JUNGLE: 5 }, // Smolder (actually adc)
  "893": { MID: 90, TOP: 10 }, // Aurora
  "910": { MID: 85, JUNGLE: 15 }, // Hwei
  
  // === ADCs principaux ===
  "22": { ADC: 90, SUPPORT: 10 }, // Ashe
  "51": { ADC: 95, MID: 5 }, // Caitlyn
  "119": { ADC: 95, MID: 5 }, // Draven
  "81": { ADC: 90, MID: 10 }, // Ezreal
  "202": { ADC: 95, MID: 5 }, // Jhin
  "222": { ADC: 95, MID: 5 }, // Jinx
  "145": { ADC: 90, MID: 10 }, // Kai'Sa
  "429": { ADC: 95, TOP: 5 }, // Kalista
  "96": { ADC: 90, MID: 10 }, // Kog'Maw
  "236": { ADC: 85, MID: 15 }, // Lucian
  "21": { ADC: 85, SUPPORT: 15 }, // Miss Fortune
  "15": { ADC: 95, MID: 5 }, // Sivir
  "18": { ADC: 85, TOP: 10, MID: 5 }, // Tristana
  "29": { ADC: 85, TOP: 10, JUNGLE: 5 }, // Twitch
  "67": { ADC: 85, TOP: 15 }, // Vayne
  "110": { ADC: 85, MID: 15 }, // Varus
  "498": { ADC: 95, MID: 5 }, // Xayah
  "360": { ADC: 90, MID: 10 }, // Samira
  "147": { ADC: 50, SUPPORT: 50 }, // Seraphine
  "895": { ADC: 95, MID: 5 }, // Nilah
  "901": { ADC: 90, MID: 10 }, // Smolder
  "804": { ADC: 90, MID: 10 }, // Yunara
  "17": { ADC: 40, TOP: 40, SUPPORT: 20 }, // Teemo
  "133": { ADC: 30, TOP: 60, MID: 10 }, // Quinn
  "43": { SUPPORT: 70, MID: 30 }, // Karma
  
  // === SUPPORTS principaux ===
  "12": { SUPPORT: 95, TOP: 5 }, // Alistar
  "432": { SUPPORT: 95, MID: 5 }, // Bard
  "53": { SUPPORT: 95, TOP: 5 }, // Blitzcrank
  "201": { SUPPORT: 95, TOP: 5 }, // Braum
  "40": { SUPPORT: 95, MID: 5 }, // Janna
  "89": { SUPPORT: 95, TOP: 5 }, // Leona
  "117": { SUPPORT: 85, MID: 15 }, // Lulu
  "25": { SUPPORT: 80, MID: 20 }, // Morgana
  "267": { SUPPORT: 95, MID: 5 }, // Nami
  "111": { SUPPORT: 85, TOP: 10, JUNGLE: 5 }, // Nautilus
  "497": { SUPPORT: 95, MID: 5 }, // Rakan
  "37": { SUPPORT: 95, MID: 5 }, // Sona
  "16": { SUPPORT: 95, MID: 5 }, // Soraka
  "44": { SUPPORT: 95, TOP: 5 }, // Taric
  "412": { SUPPORT: 95, TOP: 5 }, // Thresh
  "143": { SUPPORT: 80, MID: 20 }, // Zyra
  "350": { SUPPORT: 95, MID: 5 }, // Yuumi
  "526": { SUPPORT: 95, JUNGLE: 5 }, // Rell
  "555": { SUPPORT: 85, MID: 15 }, // Pyke
  "235": { SUPPORT: 70, ADC: 30 }, // Senna
  "50": { SUPPORT: 50, MID: 30, ADC: 20 }, // Swain
  "518": { SUPPORT: 70, MID: 30 }, // Neeko
  "888": { SUPPORT: 95, MID: 5 }, // Renata Glasc
  "902": { SUPPORT: 95, MID: 5 }, // Milio
};

/**
 * Détecte le rôle probable d'un joueur basé sur son champion et ses summoner spells
 * @param {number} championId - ID du champion
 * @param {number} spell1Id - Premier summoner spell
 * @param {number} spell2Id - Second summoner spell
 * @returns {string} Le rôle détecté (TOP, JUNGLE, MID, ADC, SUPPORT)
 */
function detectRole(championId, spell1Id, spell2Id) {
  const spells = [spell1Id, spell2Id];
  
  // Smite = Jungler (100% certain)
  if (spells.includes(SUMMONER_SPELLS.SMITE)) {
    return "JUNGLE";
  }
  
  // Récupérer les probabilités du champion
  const champProbs = CHAMPION_ROLE_PROBABILITY[String(championId)] || {};
  
  // Ajuster les probabilités en fonction des summoner spells
  let probs = { TOP: 0, JUNGLE: 0, MID: 0, ADC: 0, SUPPORT: 0 };
  
  // Copier les probabilités de base du champion
  for (const role of Object.keys(probs)) {
    probs[role] = champProbs[role] || 0;
  }
  
  // Si pas de probs connues, utiliser des valeurs par défaut
  if (Object.values(probs).every(v => v === 0)) {
    probs = { TOP: 20, JUNGLE: 0, MID: 20, ADC: 30, SUPPORT: 30 };
  }
  
  // Jungler impossible sans smite
  probs.JUNGLE = 0;
  
  // Heal favorise ADC (et un peu support)
  if (spells.includes(SUMMONER_SPELLS.HEAL)) {
    probs.ADC *= 2;
    probs.SUPPORT *= 1.3;
    probs.TOP *= 0.3;
    probs.MID *= 0.5;
  }
  
  // Teleport favorise Top et Mid
  if (spells.includes(SUMMONER_SPELLS.TELEPORT)) {
    probs.TOP *= 2;
    probs.MID *= 1.5;
    probs.ADC *= 0.3;
    probs.SUPPORT *= 0.3;
  }
  
  // Exhaust favorise Support
  if (spells.includes(SUMMONER_SPELLS.EXHAUST)) {
    probs.SUPPORT *= 2;
    probs.MID *= 0.7;
    probs.ADC *= 0.5;
  }
  
  // Barrier favorise Mid et ADC
  if (spells.includes(SUMMONER_SPELLS.BARRIER)) {
    probs.MID *= 1.5;
    probs.ADC *= 1.3;
    probs.SUPPORT *= 0.5;
  }
  
  // Ignite peut être Mid, Support ou Top
  if (spells.includes(SUMMONER_SPELLS.IGNITE)) {
    probs.MID *= 1.3;
    probs.SUPPORT *= 1.2;
    probs.TOP *= 1.1;
  }
  
  // Ghost favorise certains tops/mids
  if (spells.includes(SUMMONER_SPELLS.GHOST)) {
    probs.TOP *= 1.3;
    probs.MID *= 1.2;
  }
  
  // Cleanse favorise ADC et Mid
  if (spells.includes(SUMMONER_SPELLS.CLEANSE)) {
    probs.ADC *= 1.5;
    probs.MID *= 1.3;
  }
  
  // Retourner le rôle avec la plus haute probabilité
  let maxProb = 0;
  let detectedRole = "UNKNOWN";
  for (const [role, prob] of Object.entries(probs)) {
    if (prob > maxProb) {
      maxProb = prob;
      detectedRole = role;
    }
  }
  
  return detectedRole;
}

/**
 * Trie les participants par rôle (TOP, JGL, MID, ADC, SUP)
 * @param {Array} participants - Liste des participants avec championId et spells
 * @returns {Array} Participants triés par rôle
 */
function sortParticipantsByRole(participants) {
  // Détecter le rôle de chaque participant
  const withRoles = participants.map(p => ({
    ...p,
    detectedRole: detectRole(p.championId, p.spell1Id, p.spell2Id),
    roleScores: { ...CHAMPION_ROLE_PROBABILITY[String(p.championId)] } || {}
  }));
  
  // Assigner les rôles en évitant les doublons
  const assignedRoles = new Set();
  const result = [];
  const allRoles = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
  
  // Premier passage : assigner le Jungle avec Smite (100% certain)
  for (const p of withRoles) {
    if (p.detectedRole === "JUNGLE" && !assignedRoles.has("JUNGLE")) {
      assignedRoles.add("JUNGLE");
      result.push({ ...p, role: "JUNGLE" });
    }
  }
  
  // Deuxième passage : assigner les rôles par meilleur score
  let remaining = withRoles.filter(p => !result.find(r => r.puuid === p.puuid));
  
  while (remaining.length > 0 && assignedRoles.size < 5) {
    let bestMatch = null;
    let bestRole = null;
    let bestScore = -1;
    
    for (const p of remaining) {
      for (const role of allRoles) {
        if (assignedRoles.has(role)) continue;
        
        let score = 0;
        // Score basé sur le rôle détecté
        if (p.detectedRole === role) score += 50;
        // Score basé sur les probabilités du champion
        score += (p.roleScores[role] || 0);
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = p;
          bestRole = role;
        }
      }
    }
    
    if (bestMatch && bestRole) {
      assignedRoles.add(bestRole);
      result.push({ ...bestMatch, role: bestRole });
      remaining = remaining.filter(r => r.puuid !== bestMatch.puuid);
    } else {
      break;
    }
  }
  
  // Dernier passage : assigner les joueurs restants aux rôles restants
  for (const p of remaining) {
    for (const role of allRoles) {
      if (!assignedRoles.has(role)) {
        assignedRoles.add(role);
        result.push({ ...p, role });
        break;
      }
    }
    // Si vraiment plus de rôle dispo
    if (!result.find(r => r.puuid === p.puuid)) {
      result.push({ ...p, role: "UNKNOWN" });
    }
  }
  
  // Trier par ordre de rôle : TOP, JUNGLE, MID, ADC, SUPPORT
  result.sort((a, b) => (ROLE_ORDER[a.role] ?? 5) - (ROLE_ORDER[b.role] ?? 5));
  
  return result;
}

// Emojis pour les rôles
const ROLE_EMOJIS = {
  TOP: "🗡️",
  JUNGLE: "🌲",
  MID: "⭐",
  ADC: "🏹",
  SUPPORT: "🛡️",
  UNKNOWN: "❓"
};

function getRoleEmoji(role) {
  return ROLE_EMOJIS[role] || "❓";
}

// =====================
// WALLET MANAGEMENT
// =====================

function loadWallets() {
  try {
    const raw = fs.readFileSync(WALLETS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { wallets: {}, defaultTokens: DEFAULT_TOKENS };
  }
}

function saveWallets(data) {
  fs.mkdirSync(path.dirname(WALLETS_PATH), { recursive: true });
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getWallet(userId) {
  const data = loadWallets();
  if (!data.wallets[userId]) {
    data.wallets[userId] = {
      balance: data.defaultTokens || DEFAULT_TOKENS,
      totalWon: 0,
      totalLost: 0,
      betsWon: 0,
      betsLost: 0,
      createdAt: new Date().toISOString()
    };
    saveWallets(data);
  }
  return data.wallets[userId];
}

function updateWallet(userId, amount, isWin = null) {
  const data = loadWallets();
  if (!data.wallets[userId]) {
    getWallet(userId); // Initialize
    return updateWallet(userId, amount, isWin);
  }
  
  data.wallets[userId].balance += amount;
  
  if (isWin === true) {
    data.wallets[userId].totalWon += amount;
    data.wallets[userId].betsWon += 1;
  } else if (isWin === false) {
    data.wallets[userId].totalLost += Math.abs(amount);
    data.wallets[userId].betsLost += 1;
  }
  
  saveWallets(data);
  return data.wallets[userId];
}

function getLeaderboardWallets(limit = 10) {
  const data = loadWallets();
  return Object.entries(data.wallets)
    .map(([userId, wallet]) => ({ userId, ...wallet }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

/**
 * Classement des parieurs par winrate
 * @param {number} minBets - Nombre minimum de paris pour apparaître
 */
function getBettorsLeaderboard(limit = 15, minBets = 1) {
  const data = loadWallets();
  return Object.entries(data.wallets)
    .map(([userId, wallet]) => {
      const totalBets = (wallet.betsWon || 0) + (wallet.betsLost || 0);
      const winrate = totalBets > 0 ? ((wallet.betsWon || 0) / totalBets) * 100 : 0;
      return { 
        userId, 
        betsWon: wallet.betsWon || 0,
        betsLost: wallet.betsLost || 0,
        totalBets,
        winrate,
        totalWon: wallet.totalWon || 0,
        totalLost: wallet.totalLost || 0,
        profit: (wallet.totalWon || 0) - (wallet.totalLost || 0),
        balance: wallet.balance
      };
    })
    .filter(u => u.totalBets >= minBets)
    .sort((a, b) => {
      // Trier par winrate, puis par nombre de paris, puis par profit
      if (b.winrate !== a.winrate) return b.winrate - a.winrate;
      if (b.totalBets !== a.totalBets) return b.totalBets - a.totalBets;
      return b.profit - a.profit;
    })
    .slice(0, limit);
}

// =====================
// BETS MANAGEMENT
// =====================

function loadBets() {
  try {
    const raw = fs.readFileSync(BETS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { activeBets: {}, betHistory: [] };
  }
}

function saveBets(data) {
  fs.mkdirSync(path.dirname(BETS_PATH), { recursive: true });
  fs.writeFileSync(BETS_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getActiveBet(gameId) {
  const data = loadBets();
  return data.activeBets[gameId] || null;
}

function getAllActiveBets() {
  const data = loadBets();
  return data.activeBets;
}

/**
 * Calcule les cotes dynamiques style Twitch/parimutuel
 * La cote diminue quand plus de jetons sont misés sur un côté
 * 
 * Système parimutuel: Les gains sont redistribués proportionnellement
 * Cote = (Pool total + mise) / (Pool du côté + mise)
 */
function calculateOdds(bluePool, redPool) {
  const totalPool = bluePool + redPool;
  
  // Si personne n'a parié, cotes égales
  if (totalPool === 0) {
    return { blue: 2.0, red: 2.0 };
  }
  
  // Calcul parimutuel classique
  // Si un côté a 0, on simule une mise minimale pour éviter des cotes infinies
  const effectiveBlue = Math.max(bluePool, 1);
  const effectiveRed = Math.max(redPool, 1);
  const effectiveTotal = effectiveBlue + effectiveRed;
  
  // Cote = ce que tu récupères pour 1 jeton misé
  // Plus ton côté est minoritaire, plus la cote est haute
  let blueOdds = effectiveTotal / effectiveBlue;
  let redOdds = effectiveTotal / effectiveRed;
  
  // Limites: min 1.01 (tu récupères au moins ta mise), max 5.0 (évite les cotes trop déséquilibrées)
  blueOdds = Math.min(5.0, Math.max(1.01, blueOdds));
  redOdds = Math.min(5.0, Math.max(1.01, redOdds));
  
  return {
    blue: Math.round(blueOdds * 100) / 100,
    red: Math.round(redOdds * 100) / 100
  };
}

/**
 * Crée un nouveau pari pour une game
 * @param {Object} gameInfo - Info de la game depuis l'API Spectator
 * @param {Object} trackedPlayer - Joueur tracké depuis le leaderboard
 * @param {Object} trackedPlayerTeam - Info du joueur dans la game
 * @param {Object} participantsNames - Map { puuid: gameName } des pseudos
 * @param {Object} participantsRanks - Map { puuid: { tier, rank, lp } } des rangs
 */
function createBet(gameInfo, trackedPlayer, trackedPlayerTeam, participantsNames = {}, participantsRanks = {}) {
  const data = loadBets();
  const gameId = String(gameInfo.gameId);
  
  if (data.activeBets[gameId]) {
    return data.activeBets[gameId];
  }
  
  // Préparer les participants avec leurs spells pour le tri par rôle
  const blueParticipants = gameInfo.participants
    .filter(p => p.teamId === 100)
    .map(p => ({
      puuid: p.puuid,
      playerName: p.puuid ? (participantsNames[p.puuid] || null) : null,
      rankInfo: p.puuid ? (participantsRanks[p.puuid] || null) : null,
      championId: p.championId,
      championName: getChampionName(p.championId),
      championIcon: getChampionIcon(p.championId),
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id
    }));
  
  const redParticipants = gameInfo.participants
    .filter(p => p.teamId === 200)
    .map(p => ({
      puuid: p.puuid,
      playerName: p.puuid ? (participantsNames[p.puuid] || null) : null,
      rankInfo: p.puuid ? (participantsRanks[p.puuid] || null) : null,
      championId: p.championId,
      championName: getChampionName(p.championId),
      championIcon: getChampionIcon(p.championId),
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id
    }));
  
  // Trier par rôle détecté
  const sortedBlue = sortParticipantsByRole(blueParticipants);
  const sortedRed = sortParticipantsByRole(redParticipants);
  
  const bet = {
    gameId,
    trackedPlayer: {
      puuid: trackedPlayer.puuid,
      discordId: trackedPlayer.discordId,
      gameName: trackedPlayer.gameName,
      tagLine: trackedPlayer.tagLine,
      championId: trackedPlayerTeam.championId,
      championName: getChampionName(trackedPlayerTeam.championId),
      championIcon: getChampionIcon(trackedPlayerTeam.championId),
      teamId: trackedPlayerTeam.teamId // 100 = Blue, 200 = Red
    },
    gameStartTime: gameInfo.gameStartTime,
    bettingEndsAt: Date.now() + BETTING_WINDOW_MS,
    status: "open", // open, closed, resolved
    blueTeam: {
      participants: sortedBlue
    },
    redTeam: {
      participants: sortedRed
    },
    bets: {
      blue: [],
      red: []
    },
    pools: {
      blue: 0,
      red: 0
    },
    messageId: null,
    channelId: null,
    createdAt: new Date().toISOString()
  };
  
  data.activeBets[gameId] = bet;
  saveBets(data);
  
  return bet;
}

/**
 * Place un pari sur une game
 */
function placeBet(gameId, userId, team, amount) {
  const data = loadBets();
  const bet = data.activeBets[gameId];
  
  if (!bet) {
    return { success: false, error: "Pari introuvable" };
  }
  
  if (bet.status !== "open") {
    return { success: false, error: "Les paris sont fermés pour cette game" };
  }
  
  if (Date.now() > bet.bettingEndsAt) {
    bet.status = "closed";
    saveBets(data);
    return { success: false, error: "Le temps pour parier est écoulé" };
  }
  
  if (amount < MIN_BET) {
    return { success: false, error: `Mise minimum: ${MIN_BET} jetons` };
  }
  
  if (amount > MAX_BET) {
    return { success: false, error: `Mise maximum: ${MAX_BET} jetons` };
  }
  
  // Vérifier si l'utilisateur a déjà parié
  const existingBetBlue = bet.bets.blue.find(b => b.userId === userId);
  const existingBetRed = bet.bets.red.find(b => b.userId === userId);
  
  if (existingBetBlue || existingBetRed) {
    return { success: false, error: "Vous avez déjà parié sur cette game" };
  }
  
  // Vérifier le solde
  const wallet = getWallet(userId);
  if (wallet.balance < amount) {
    return { success: false, error: `Solde insuffisant (${wallet.balance} jetons)` };
  }
  
  // Calculer les cotes actuelles
  const currentOdds = calculateOdds(bet.pools.blue, bet.pools.red);
  
  // Déduire les jetons
  updateWallet(userId, -amount);
  
  // Enregistrer le pari
  const betEntry = {
    userId,
    amount,
    oddsAtBet: currentOdds[team],
    placedAt: new Date().toISOString()
  };
  
  bet.bets[team].push(betEntry);
  bet.pools[team] += amount;
  
  saveBets(data);
  
  const newOdds = calculateOdds(bet.pools.blue, bet.pools.red);
  
  return {
    success: true,
    bet: betEntry,
    newOdds,
    totalPool: bet.pools.blue + bet.pools.red
  };
}

/**
 * Ferme les paris pour une game (appelé automatiquement après le délai)
 */
function closeBetting(gameId) {
  const data = loadBets();
  const bet = data.activeBets[gameId];
  
  if (bet && bet.status === "open") {
    bet.status = "closed";
    saveBets(data);
  }
  
  return bet;
}

/**
 * Résout un pari (victoire blue ou red)
 */
function resolveBet(gameId, winningTeam) {
  const data = loadBets();
  const bet = data.activeBets[gameId];
  
  if (!bet) {
    return { success: false, error: "Pari introuvable" };
  }
  
  if (bet.status === "resolved") {
    return { success: false, error: "Pari déjà résolu" };
  }
  
  const losingTeam = winningTeam === "blue" ? "red" : "blue";
  const totalPool = bet.pools.blue + bet.pools.red;
  
  const results = {
    winners: [],
    losers: [],
    totalDistributed: 0
  };
  
  // Calculer les gains des gagnants
  for (const winner of bet.bets[winningTeam]) {
    const winnings = Math.floor(winner.amount * winner.oddsAtBet);
    updateWallet(winner.userId, winnings, true);
    results.winners.push({
      oddsAtBet: winner.oddsAtBet,
      amount: winner.amount,
      winnings,
      userId: winner.userId
    });
    results.totalDistributed += winnings;
  }
  
  // Marquer les perdants
  for (const loser of bet.bets[losingTeam]) {
    updateWallet(loser.userId, 0, false); // Juste pour les stats
    results.losers.push({
      userId: loser.userId,
      amount: loser.amount,
      oddsAtBet: loser.oddsAtBet
    });
  }
  
  // Archiver le pari
  bet.status = "resolved";
  bet.resolvedAt = new Date().toISOString();
  bet.winningTeam = winningTeam;
  bet.results = results;
  
  // Déplacer vers l'historique
  data.betHistory.push(bet);
  delete data.activeBets[gameId];
  
  // Garder seulement les 100 derniers paris dans l'historique
  if (data.betHistory.length > 100) {
    data.betHistory = data.betHistory.slice(-100);
  }
  
  saveBets(data);
  
  return { success: true, bet, results };
}

/**
 * Annule un pari et rembourse tout le monde
 */
function cancelBet(gameId) {
  const data = loadBets();
  const bet = data.activeBets[gameId];
  
  if (!bet) {
    return { success: false, error: "Pari introuvable" };
  }
  
  // Rembourser tous les parieurs
  for (const entry of [...bet.bets.blue, ...bet.bets.red]) {
    updateWallet(entry.userId, entry.amount);
  }
  
  bet.status = "cancelled";
  bet.cancelledAt = new Date().toISOString();
  
  data.betHistory.push(bet);
  delete data.activeBets[gameId];
  saveBets(data);
  
  return { success: true, refunded: bet.bets.blue.length + bet.bets.red.length };
}

// =====================
// SPECTATOR API
// =====================

async function riotFetch(url) {
  const response = await fetch(url, {
    headers: { "X-Riot-Token": riotApiKey }
  });

  if (!response.ok) {
    const error = new Error(`Riot API error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * Vérifie si un joueur est en game
 * Retourne les infos de la game ou null
 */
async function checkLiveGame(puuid) {
  try {
    const gameInfo = await riotFetch(
      `${SPECTATOR_API}/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`
    );
    return gameInfo;
  } catch (error) {
    if (error.status === 404) {
      return null; // Pas en game
    }
    throw error;
  }
}

/**
 * Récupère le pseudo d'un joueur via son PUUID
 */
async function getPlayerNameByPuuid(puuid) {
  if (!puuid) {
    return null; // Sera affiché comme "StreamerMode"
  }
  try {
    const account = await riotFetch(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
    );
    // Retourner le pseudo complet avec #tagLine
    const fullName = account.gameName && account.tagLine 
      ? `${account.gameName}#${account.tagLine}` 
      : account.gameName || null;
    if (fullName) {
      console.log(`[Betting] ✓ ${fullName}`);
    }
    return fullName;
  } catch (error) {
    console.error(`[Betting] ✗ Erreur PUUID ${puuid.slice(0, 8)}...: ${error.status || error.message}`);
    return null;
  }
}

/**
 * Récupère les pseudos de tous les participants d'une game
 * Retourne un objet { puuid: gameName }
 */
async function getParticipantsNames(participants) {
  const names = {};
  const validParticipants = participants.filter(p => p.puuid);
  
  console.log(`[Betting] 📋 Récupération des pseudos (${validParticipants.length}/${participants.length} avec PUUID)...`);
  
  for (let i = 0; i < validParticipants.length; i++) {
    const p = validParticipants[i];
    // Délai de 1.5s entre chaque requête pour respecter le rate limit
    if (i > 0) {
      await new Promise(r => setTimeout(r, 1500));
    }
    const name = await getPlayerNameByPuuid(p.puuid);
    if (name) {
      names[p.puuid] = name;
    }
  }
  
  console.log(`[Betting] ✅ ${Object.keys(names).length} pseudos récupérés`);
  return names;
}

/**
 * Récupère le rang SoloQ d'un joueur via son PUUID
 * Retourne { tier: "GOLD", rank: "II", lp: 50, wins: 100, losses: 50, winrate: 66.7 } ou null
 */
async function getPlayerRank(puuid) {
  if (!puuid) return null;
  try {
    const entries = await riotFetch(
      `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
    );
    const soloQ = entries.find(e => e.queueType === "RANKED_SOLO_5x5");
    if (soloQ) {
      const wins = soloQ.wins || 0;
      const losses = soloQ.losses || 0;
      const totalGames = wins + losses;
      const winrate = totalGames > 0 ? (wins / totalGames) * 100 : 0;
      return { 
        tier: soloQ.tier, 
        rank: soloQ.rank, 
        lp: soloQ.leaguePoints,
        wins,
        losses,
        winrate: Math.round(winrate * 10) / 10 // 1 décimale
      };
    }
    return null;
  } catch (error) {
    console.error(`[Betting] ✗ Erreur rank PUUID ${puuid.slice(0, 8)}...: ${error.status || error.message}`);
    return null;
  }
}

/**
 * Récupère les rangs de tous les participants
 * Retourne un objet { puuid: { tier, rank, lp } }
 */
async function getParticipantsRanks(participants) {
  const ranks = {};
  const validParticipants = participants.filter(p => p.puuid);
  
  console.log(`[Betting] 🏆 Récupération des rangs (${validParticipants.length} joueurs)...`);
  
  for (let i = 0; i < validParticipants.length; i++) {
    const p = validParticipants[i];
    if (i > 0) {
      await new Promise(r => setTimeout(r, 1500));
    }
    const rankInfo = await getPlayerRank(p.puuid);
    if (rankInfo) {
      ranks[p.puuid] = rankInfo;
      console.log(`[Betting] ✓ Rank trouvé: ${rankInfo.tier} ${rankInfo.rank}`);
    }
  }
  
  console.log(`[Betting] ✅ ${Object.keys(ranks).length} rangs récupérés`);
  return ranks;
}

/**
 * Récupère les infos du joueur tracké dans la game
 */
function getTrackedPlayerInGame(gameInfo, puuid) {
  return gameInfo.participants.find(p => p.puuid === puuid) || null;
}

/**
 * Vérifie si c'est une game de SoloQ ranked
 */
function isSoloQGame(gameInfo) {
  // Queue ID 420 = Ranked Solo/Duo
  return gameInfo.gameQueueConfigId === 420;
}

/**
 * Récupère les dernières games d'un joueur via Match-V5
 * @param {string} puuid - PUUID du joueur
 * @param {number} count - Nombre de games à récupérer (max 20)
 */
async function getRecentMatches(puuid, count = 5) {
  try {
    const matchIds = await riotFetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${count}`
    );
    return matchIds || [];
  } catch (error) {
    console.error(`[Betting] Erreur récupération matches: ${error.status || error.message}`);
    return [];
  }
}

/**
 * Récupère les détails d'une game via Match-V5
 * @param {string} matchId - ID de la game (ex: EUW1_1234567890)
 */
async function getMatchDetails(matchId) {
  try {
    const match = await riotFetch(
      `https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`
    );
    return match;
  } catch (error) {
    console.error(`[Betting] Erreur détails match ${matchId}: ${error.status || error.message}`);
    return null;
  }
}

/**
 * Vérifie si une game est terminée et récupère le résultat
 * Compare le gameId du pari avec les matchs récents du joueur
 * @param {Object} bet - Le pari actif
 * @returns {Object|null} { finished: true, winner: "blue"|"red" } ou null si pas fini
 */
async function checkGameResult(bet) {
  const puuid = bet.trackedPlayer.puuid;
  const gameId = bet.gameId;
  
  // Récupérer les 5 dernières games du joueur
  const recentMatchIds = await getRecentMatches(puuid, 5);
  
  if (!recentMatchIds.length) {
    return null;
  }
  
  // Chercher la game correspondante (le gameId Spectator correspond à la fin du matchId)
  // Format matchId: "EUW1_1234567890" où 1234567890 est le gameId
  const matchId = recentMatchIds.find(id => id.endsWith(`_${gameId}`));
  
  if (!matchId) {
    // La game n'est pas encore dans l'historique (peut-être encore en cours ou trop récente)
    return null;
  }
  
  // Récupérer les détails de la game
  await new Promise(r => setTimeout(r, 1500)); // Rate limit
  const match = await getMatchDetails(matchId);
  
  if (!match || !match.info) {
    return null;
  }
  
  // Trouver le joueur tracké dans les participants
  const participant = match.info.participants.find(p => p.puuid === puuid);
  
  if (!participant) {
    return null;
  }
  
  // Déterminer l'équipe gagnante
  // teamId 100 = Blue, teamId 200 = Red
  const playerTeamId = participant.teamId;
  const playerWon = participant.win;
  
  let winningTeam;
  if (playerTeamId === 100) {
    winningTeam = playerWon ? "blue" : "red";
  } else {
    winningTeam = playerWon ? "red" : "blue";
  }
  
  return {
    finished: true,
    winner: winningTeam,
    matchId: matchId,
    gameDuration: match.info.gameDuration, // en secondes
    gameEndTimestamp: match.info.gameEndTimestamp
  };
}

/**
 * Charge les joueurs trackés depuis le leaderboard
 */
function loadTrackedPlayers() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_PATH, "utf8");
    const data = JSON.parse(raw);
    return data.entries || [];
  } catch {
    return [];
  }
}

module.exports = {
  // Wallet
  getWallet,
  updateWallet,
  getLeaderboardWallets,
  getBettorsLeaderboard,
  loadWallets,
  
  // Bets
  createBet,
  placeBet,
  closeBetting,
  resolveBet,
  cancelBet,
  getActiveBet,
  getAllActiveBets,
  calculateOdds,
  loadBets,
  
  // Spectator & Match
  checkLiveGame,
  checkGameResult,
  getRecentMatches,
  getMatchDetails,
  getTrackedPlayerInGame,
  isSoloQGame,
  loadTrackedPlayers,
  loadChampionNames,
  getChampionName,
  getChampionIcon,
  getParticipantsNames,
  getParticipantsRanks,
  getPlayerRank,
  
  // Role detection
  ROLE_EMOJIS,
  detectRole,
  sortParticipantsByRole,
  
  // Constants
  MIN_BET,
  MAX_BET,
  DEFAULT_TOKENS,
  BETTING_WINDOW_MS,
  ddragonVersion: () => ddragonVersion
};
