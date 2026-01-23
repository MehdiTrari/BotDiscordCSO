require("dotenv").config();

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID"];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[WARN] Missing env var: ${key}`);
  }
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  riotApiKey: (process.env.RIOT_API_KEY || "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1"),
};
