const fs = require("node:fs");
const path = require("node:path");
const { riotApiKey } = require("./config");
const fetch = global.fetch || require("node-fetch");

const DATA_PATH = path.join(__dirname, "data", "leaderboard.json");
const PIN_PATH = path.join(__dirname, "data", "pin.json");
const ACCOUNT_API = "https://europe.api.riotgames.com";
const SUMMONER_API = "https://euw1.api.riotgames.com";

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
const RATE_LIMIT_MS = 2500; // 2.5 sec entre chaque appel API pour éviter le rate limit

function parseRiotId(input) {
  if (!input) return null;
  const splitIndex = input.lastIndexOf("#");
  if (splitIndex <= 0 || splitIndex === input.length - 1) return null;
  const gameName = input.slice(0, splitIndex).trim();
  const tagLine = input.slice(splitIndex + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.entries || !Array.isArray(parsed.entries)) {
      return { entries: [], snapshot: null };
    }
    return { entries: parsed.entries, snapshot: parsed.snapshot || null };
  } catch {
    return { entries: [], snapshot: null };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function scoreRank(entry) {
  if (!entry || entry.tier === "UNRANKED") return -1;
  const tierIndex = TIER_ORDER.indexOf(entry.tier);
  let rankIndex = RANK_ORDER.indexOf(entry.rank);
  if (
    rankIndex < 0 &&
    ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier)
  ) {
    rankIndex = RANK_ORDER.length - 1;
  }
  if (tierIndex < 0 || rankIndex < 0) return -1;
  return tierIndex * 1000 + rankIndex * 100 + entry.lp;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function riotFetch(url) {
  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": riotApiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Riot API error ${response.status}`);
    error.status = response.status;
    error.url = url;
    error.body = body;
    throw error;
  }

  return response.json();
}

async function resolveAccount(gameName, tagLine) {
  return riotFetch(
    `${ACCOUNT_API}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
      gameName
    )}/${encodeURIComponent(tagLine)}`
  );
}

async function resolveAccountByPuuid(puuid) {
  return riotFetch(
    `${ACCOUNT_API}/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
  );
}

async function resolvePuuid(gameName, tagLine) {
  const account = await resolveAccount(gameName, tagLine);
  return account.puuid;
}

async function fetchSoloQueue(puuid) {
  const entries = await riotFetch(
    `${SUMMONER_API}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  );
  return entries.find((entry) => entry.queueType === "RANKED_SOLO_5x5") || null;
}

async function refreshLeaderboard() {
  if (!riotApiKey) {
    throw new Error("RIOT_API_KEY manquant");
  }

  const data = loadData();
  if (!data.entries.length) {
    data.snapshot = {
      updatedAt: new Date().toISOString(),
      items: [],
    };
    saveData(data);
    return data.snapshot;
  }

  const results = [];

  for (const entry of data.entries) {
    try {
      // Si on a déjà le PUUID, on récupère le pseudo actuel via l'API
      // pour gérer les changements de pseudo
      if (entry.puuid) {
        await sleep(RATE_LIMIT_MS);
        try {
          const account = await resolveAccountByPuuid(entry.puuid);
          // Mettre à jour le gameName/tagLine si changé
          if (account.gameName !== entry.gameName || account.tagLine !== entry.tagLine) {
            console.log(`[Leaderboard] Pseudo mis à jour: ${entry.gameName}#${entry.tagLine} → ${account.gameName}#${account.tagLine}`);
            entry.gameName = account.gameName;
            entry.tagLine = account.tagLine;
          }
        } catch (err) {
          // Si erreur 404, le compte n'existe plus
          if (err.status === 404) {
            console.warn(`[Leaderboard] Compte introuvable pour PUUID ${entry.puuid}`);
          }
          // Continuer avec les anciennes infos
        }
      } else {
        // Pas de PUUID stocké, on le récupère via gameName/tagLine
        await sleep(RATE_LIMIT_MS);
        const account = await resolveAccount(entry.gameName, entry.tagLine);
        entry.puuid = account.puuid;
      }

      await sleep(RATE_LIMIT_MS);
      const solo = await fetchSoloQueue(entry.puuid);

      if (!solo) {
        results.push({
          discordId: entry.discordId,
          riotName: `${entry.gameName}#${entry.tagLine}`,
          tier: "UNRANKED",
          rank: "",
          lp: 0,
          wins: 0,
          losses: 0,
          totalGames: 0,
          score: -1,
        });
        continue;
      }

      const totalGames = solo.wins + solo.losses;
      results.push({
        discordId: entry.discordId,
        riotName: `${entry.gameName}#${entry.tagLine}`,
        tier: solo.tier,
        rank: solo.rank,
        lp: solo.leaguePoints,
        wins: solo.wins,
        losses: solo.losses,
        totalGames,
        score: scoreRank(solo),
      });
    } catch (error) {
      if (error.status === 404) {
        results.push({
          discordId: entry.discordId,
          riotName: `${entry.gameName}#${entry.tagLine}`,
          tier: "UNRANKED",
          rank: "",
          lp: 0,
          wins: 0,
          losses: 0,
          totalGames: 0,
          score: -1,
        });
        continue;
      }
      throw error;
    }
  }

  results.sort((a, b) => b.score - a.score);
  data.snapshot = {
    updatedAt: new Date().toISOString(),
    items: results,
  };
  saveData(data);
  return data.snapshot;
}

function loadPinData() {
  try {
    const raw = fs.readFileSync(PIN_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePinData(data) {
  fs.mkdirSync(path.dirname(PIN_PATH), { recursive: true });
  fs.writeFileSync(PIN_PATH, JSON.stringify(data, null, 2), "utf8");
}

function clearPinData() {
  try {
    fs.unlinkSync(PIN_PATH);
  } catch {
    // ignore
  }
}

module.exports = {
  loadData,
  saveData,
  parseRiotId,
  refreshLeaderboard,
  resolvePuuid,
  loadPinData,
  savePinData,
  clearPinData,
};
