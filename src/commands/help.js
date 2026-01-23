const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const EMBED_COLOR = 0xb10f0f;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Afficher l'aide du bot"),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("📊 Leaderboard LoL - CSO")
      .setDescription("Suivez le classement Solo/Duo des membres de la CSO en temps réel !")
      .addFields(
        {
          name: "🎮 Commandes",
          value: [
            "`/lolboard display` — Afficher le leaderboard (auto-refresh 20 min)",
            "`/lolboard stop` — Retirer le leaderboard",
            "`/lolboard add @membre Pseudo#Tag` — Lier un compte LoL",
            "`/lolboard kick @membre` — Retirer un membre",
            "`/panel` — Créer le panel de contrôle",
          ].join("\n"),
        },
        {
          name: "🔗 Comment lier son compte ?",
          value: [
            "**Option 1:** Clique sur le bouton **Lier mon compte** du panel",
            "**Option 2:** Demande à un admin d'utiliser `/lolboard add`",
          ].join("\n"),
        },
        {
          name: "✨ Fonctionnalités",
          value: [
            "• Classement automatique par rang et LP",
            "• Lien direct vers ton profil OP.GG",
            "• Mise à jour automatique toutes les 5 minutes",
            "• Panel interactif avec boutons",
          ].join("\n"),
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
